import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;
const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

/**
 * R6.2 (§4-9, §8) : poste déjà réglé AVANT la saisie de ce plan (ex. Uniforme
 * 3400 DH payé en août pour un plan créé en septembre) — accountId reste
 * facultatif (CAS A/B, cf. already-paid.util.ts).
 */
export class SchoolWizardAlreadyPaidDto {
  @IsNumber()
  amount!: number;

  @IsISO8601()
  paidDate!: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

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

  /**
   * Lot 11 (§20 cadrage V1) : périodicité du poste — absent/ponctuel = une seule
   * Deadline (comportement historique). Toute autre valeur : le ChargePlan passe
   * en generationMode=auto_frequence, seule LA PREMIÈRE Deadline (dueDate) est
   * créée ici ; les occurrences suivantes sont générées par
   * ensureChargeDeadlinesUntil (même moteur que les charges récurrentes
   * génériques, Lot 11 §1 — jamais une deuxième logique de récurrence).
   */
  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  /** Enfants concernés par cette ligne précise — défaut : tous les enfants du plan. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  childIds?: string[];

  /**
   * R6.2 (§4-9, §8) : si fourni, ce poste est créé directement soldé + son
   * Payment historique (jamais une échéance ouverte) — amount/dueDate du
   * poste ne servent alors que d'affichage/plan, le montant réellement payé
   * fait foi (cf. already-paid.util.ts).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => SchoolWizardAlreadyPaidDto)
  alreadyPaid?: SchoolWizardAlreadyPaidDto;
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
