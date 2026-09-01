import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;

/**
 * Une étape de l'assistant (§17) : scolarité T1/T2/T3, fournitures, uniforme,
 * sorties, restauration, garderie, assurance, réinscription, autres. Toutes les
 * étapes sont passables côté mobile — l'absence d'un élément dans `items`
 * équivaut simplement à une étape passée, aucun champ obligatoire ici ne force
 * l'utilisateur à répondre à une étape qu'il veut ignorer.
 */
export class SchoolWizardItemDto {
  @IsString()
  @MinLength(1)
  label!: string;

  /** null/absent = « Je ne connais pas encore » → amount_status = inconnu (§17). */
  @IsOptional()
  @IsNumber()
  amount?: number | null;

  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsIn(OBLIGATION_VALUES)
  obligationStatus?: (typeof OBLIGATION_VALUES)[number];

  /** Enfants concernés par cette ligne précise — défaut : tous les enfants du plan. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  childIds?: string[];
}

export class SchoolWizardDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  childIds!: string[];

  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchoolWizardItemDto)
  items!: SchoolWizardItemDto[];
}
