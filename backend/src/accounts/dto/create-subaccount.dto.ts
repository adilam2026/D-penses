import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSubaccountDto {
  @IsString()
  accountId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  /** Allocation initiale — crée automatiquement l'OPENING_BALANCE correspondante. */
  @IsOptional()
  initialAllocation?: string;
}
