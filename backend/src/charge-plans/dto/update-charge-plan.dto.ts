import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;
const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const STATUS_VALUES = ['actif', 'inactif'] as const;
const AMOUNT_STATUS_VALUES = ['inconnu', 'estime', 'confirme'] as const;

/**
 * §6 : l'utilisateur doit pouvoir changer explicitement envisagée → souscrite
 * ou envisagée → refusée (RG-108). §9 : rattacher/détacher un FinancialPlan.
 * Recette post-Vague 3 (§4) : modification des champs déclaratifs (label,
 * catégorie, fréquence, compte) et arrêt de la récurrence (status=inactif —
 * déjà filtré par ensureChargeDeadlinesUntil, jamais un second champ dupliqué).
 * "Arrêter la récurrence" ≠ "Supprimer" : status=inactif ne touche à aucune
 * Deadline/Payment existant, seule la génération future s'arrête.
 */
export class UpdateChargePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  /**
   * R6.2 (§1/§3) : "prochaine échéance" éditable — une modification ne touche
   * JAMAIS les Deadline déjà générées (ChargePlansService.update supprime
   * uniquement celles encore 'ouverte' sans aucun Payment, jamais l'historique) ;
   * seule la génération future en tient compte. null = retombe sur startDate.
   */
  @IsOptional()
  @IsISO8601()
  recurrenceAnchorDate?: string | null;

  /**
   * R6.2 (§3) : modifier le montant d'une charge récurrente — s'applique
   * uniquement aux Deadline encore 'ouverte' (jamais un paiement, même
   * partiel) ; une échéance déjà payée garde son montant historique. Même
   * couple obligatoire/exclusif que CreateDeadlineDto (RG-102/103) : fournir
   * l'un sans l'autre est refusé, sauf amountStatus=inconnu qui exige
   * l'absence d'amountCurrent.
   */
  @IsOptional()
  @IsNumber()
  amountCurrent?: number;

  @IsOptional()
  @IsIn(AMOUNT_STATUS_VALUES)
  amountStatus?: (typeof AMOUNT_STATUS_VALUES)[number];

  @IsOptional()
  @IsUUID()
  defaultAccountId?: string | null;

  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @IsOptional()
  @IsIn(OBLIGATION_VALUES)
  obligationStatus?: (typeof OBLIGATION_VALUES)[number];

  @IsOptional()
  @IsUUID()
  financialPlanId?: string | null;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}
