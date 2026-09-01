import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProvisionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isFlexible?: boolean;
}
