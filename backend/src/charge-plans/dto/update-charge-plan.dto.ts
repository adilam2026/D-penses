import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;
const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const STATUS_VALUES = ['actif', 'inactif'] as const;

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
