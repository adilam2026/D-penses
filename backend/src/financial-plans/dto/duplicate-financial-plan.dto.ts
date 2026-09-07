import { IsArray, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * R5 §3 — Duplication d'un plan (ex. scolaire) avec sélection EXPLICITE des enfants
 * bénéficiaires de la copie (jamais héritée automatiquement de l'original — la copie
 * peut concerner un autre enfant, ex. sœur/frère au même établissement).
 */
export class DuplicateFinancialPlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  childIds?: string[];
}
