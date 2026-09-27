import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
