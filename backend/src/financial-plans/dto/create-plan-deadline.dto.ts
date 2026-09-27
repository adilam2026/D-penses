import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreatePlanDeadlineDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  dueDate!: string;
}
