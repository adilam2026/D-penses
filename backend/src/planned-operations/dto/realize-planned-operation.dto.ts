import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * sourceAccountId/destinationAccountId (lot "paiement depuis une source
 * différente") : source RÉELLE de CE paiement, choisie au moment de la
 * réalisation — jamais écrite sur la planned_operation elle-même (qui garde
 * sa source PRÉVUE inchangée). Chaque paire (account+subaccount) est traitée
 * comme un tout : fournir sourceAccountId sans sourceSubaccountId signifie
 * explicitement "compte principal direct", jamais une fusion champ par champ
 * avec la source prévue d'origine.
 */
export class RealizePlannedOperationDto {
  /** Montant réel — peut différer du montant prévu (ex: prévu 700, réel 820). */
  @IsString()
  actualAmount!: string;

  @IsOptional()
  @IsDateString()
  actualDate?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  sourceAccountId?: string;

  @IsOptional()
  @IsString()
  sourceSubaccountId?: string;

  @IsOptional()
  @IsString()
  destinationAccountId?: string;

  @IsOptional()
  @IsString()
  destinationSubaccountId?: string;
}
