import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ResponsibleSource } from '@prisma/client';

/**
 * Modifier UNE occurrence (§ modification d'une occurrence) — ex. Internet
 * d'octobre 350 -> 420. Ne touche jamais la règle de récurrence ni les autres
 * occurrences ; le service refuse toute modification si l'occurrence n'est
 * plus PENDING (déjà réalisée ou annulée).
 */
export class UpdatePlannedOperationDto {
  @IsOptional()
  @IsString()
  expectedAmount?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

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

  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit des champs source/destination ci-dessus. */
  @IsOptional()
  @IsString()
  responsibleMemberId?: string;

  /** Lot "refonte Planning/À faire" §1 — cf. CreatePlannedOperationDto. Ignoré si responsibleMemberId est omis (le service ne touche alors jamais la source existante). */
  @IsOptional()
  @IsEnum(ResponsibleSource)
  responsibleSource?: ResponsibleSource;

  @IsOptional()
  @IsBoolean()
  includeInTodo?: boolean;
}
