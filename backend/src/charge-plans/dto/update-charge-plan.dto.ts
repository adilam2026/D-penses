import { IsIn, IsOptional, IsUUID } from 'class-validator';

const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;

/**
 * §6 : l'utilisateur doit pouvoir changer explicitement envisagée → souscrite
 * ou envisagée → refusée (RG-108). §9 : rattacher/détacher un FinancialPlan.
 */
export class UpdateChargePlanDto {
  @IsOptional()
  @IsIn(OBLIGATION_VALUES)
  obligationStatus?: (typeof OBLIGATION_VALUES)[number];

  @IsOptional()
  @IsUUID()
  financialPlanId?: string | null;
}
