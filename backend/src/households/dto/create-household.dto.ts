import { IsString, MinLength } from 'class-validator';

export class CreateHouseholdDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
