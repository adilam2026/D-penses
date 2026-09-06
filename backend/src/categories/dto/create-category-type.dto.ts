import { IsString, MinLength } from 'class-validator';

export class CreateCategoryTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
