import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSubaccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
