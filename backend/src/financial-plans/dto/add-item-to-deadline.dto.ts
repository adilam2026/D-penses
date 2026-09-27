import { IsString } from 'class-validator';

/** "Détail d'une échéance" (§12) — ajoute/ajuste le montant d'un poste pour CETTE échéance précisément. */
export class AddItemToDeadlineDto {
  @IsString()
  itemId!: string;

  @IsString()
  amount!: string;
}
