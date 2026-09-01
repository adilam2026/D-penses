import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateChildDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  schoolName?: string;

  @IsOptional()
  @IsString()
  schoolClass?: string;

  @IsOptional()
  @IsString()
  schoolYear?: string;
}
