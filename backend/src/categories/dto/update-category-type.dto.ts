import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

// Vague 2 §3 : renommer et/ou désactiver — jamais de suppression brutale
// (aucun endpoint DELETE), l'historique reste lisible via la FK quel que
// soit l'état "active".
export class UpdateCategoryTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
