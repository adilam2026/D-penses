import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, ValidateIf, ValidateNested } from 'class-validator';

const INCREASE_TYPES = ['aucune', 'fixe', 'pourcentage'] as const;

/** Règle d'évolution explicite pour UN poste (chargePlanId) — prime sur applyToAll*. */
export class SchoolProjectionRuleDto {
  @IsUUID()
  chargePlanId!: string;

  @IsIn(INCREASE_TYPES)
  increaseType!: (typeof INCREASE_TYPES)[number];

  /** Requis ssi increaseType != 'aucune' — jamais 0 implicite pour 'fixe'/'pourcentage'. */
  @ValidateIf((o) => o.increaseType !== 'aucune')
  @IsNumber()
  increaseValue?: number;
}

/**
 * M9 — "Projeter les années suivantes" depuis un plan École réel. Horizon = soit
 * `years` (1/3/5), soit `targetSchoolYear` explicite (mutuellement exclusifs,
 * validé côté service). Règle : `rules` (par poste) prime sur `applyToAllIncreaseType`
 * (option "Appliquer la même règle à tous") ; un poste sans règle applicable est
 * simplement ignoré (jamais une valeur inventée), cf. réponse `skipped`.
 */
export class GenerateSchoolProjectionsDto {
  @IsOptional()
  @IsIn([1, 3, 5])
  years?: number;

  @IsOptional()
  @IsString()
  targetSchoolYear?: string;

  @IsOptional()
  @IsIn(INCREASE_TYPES)
  applyToAllIncreaseType?: (typeof INCREASE_TYPES)[number];

  @ValidateIf((o) => o.applyToAllIncreaseType && o.applyToAllIncreaseType !== 'aucune')
  @IsNumber()
  applyToAllIncreaseValue?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SchoolProjectionRuleDto)
  rules?: SchoolProjectionRuleDto[];
}
