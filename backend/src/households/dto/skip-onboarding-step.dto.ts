import { IsString, MinLength } from 'class-validator';

export class SkipOnboardingStepDto {
  @IsString()
  @MinLength(1)
  step!: string;
}
