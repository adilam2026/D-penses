import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;
const STATUS_VALUES = ['actif', 'inactif'] as const;

/**
 * R6.2 (§10-12) : même philosophie que UpdateChargePlanDto — "arrêter la
 * récurrence" (status=inactif) ≠ "supprimer" : aucune AccountTransfer déjà
 * générée (prevu ou confirme) n'est jamais touchée, seule la génération
 * future s'arrête. Modifier fréquence/prochain transfert/montant ne touche
 * jamais un transfert déjà confirmé (RecurringTransfersService.update
 * supprime uniquement les occurrences encore 'prevu').
 */
export class UpdateRecurringTransferDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  @IsOptional()
  @IsISO8601()
  recurrenceAnchorDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}
