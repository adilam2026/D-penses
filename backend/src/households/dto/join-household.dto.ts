import { IsString } from 'class-validator';

export class JoinHouseholdDto {
  @IsString()
  code!: string;
}
