import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

/**
 * R6.2 (§10-12) : "Ajouter > Transfert > Récurrent" — objet séparé d'un
 * ChargePlan (RG implicite §10 : un transfert récurrent reste un TRANSFERT,
 * jamais une charge, sous peine de fausser les statistiques de dépenses).
 * `ponctuel` est volontairement absent de RECURRENCE_VALUES : un transfert
 * sans répétition passe par POST /accounts/transfer (déjà existant), jamais
 * par ce module.
 */
export class CreateRecurringTransferDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn(RECURRENCE_VALUES)
  recurrenceRule!: (typeof RECURRENCE_VALUES)[number];

  /** "Prochain transfert" — ancre de récurrence, même convention que ChargePlan/IncomeSource. */
  @IsISO8601()
  recurrenceAnchorDate!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
