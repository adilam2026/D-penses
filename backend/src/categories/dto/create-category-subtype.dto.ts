import { IsString, MinLength } from 'class-validator';

export class CreateCategorySubtypeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
