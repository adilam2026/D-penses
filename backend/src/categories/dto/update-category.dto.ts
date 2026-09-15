import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/** Corrections UI/UX finales §10 — rename + kind, y compris pour une catégorie système. */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['income', 'expense', 'both'])
  kind?: 'income' | 'expense' | 'both';
}
