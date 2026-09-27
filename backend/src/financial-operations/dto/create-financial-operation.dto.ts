import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { OperationKind } from '@prisma/client';

export class CreateFinancialOperationDto {
  @IsEnum(OperationKind)
  kind!: OperationKind;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  date!: string;

  @IsString()
  amount!: string;

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

  /** Réversion : id de l'opération annulée par celle-ci. */
  @IsOptional()
  @IsString()
  reversalOfOperationId?: string;

  @IsOptional()
  @IsString()
  reversalReason?: string;

  /** Ajouter > "Remboursable par mutuelle ?" — visible uniquement si Catégorie=Santé (cf. maquette #10/#11). */
  @IsOptional()
  @IsBoolean()
  createMedicalClaim?: boolean;
}
