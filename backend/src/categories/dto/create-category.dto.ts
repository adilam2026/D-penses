import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsIn(['income', 'expense', 'both'])
  kind!: 'income' | 'expense' | 'both';
}
