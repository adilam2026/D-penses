import { IsNumber, IsPositive } from 'class-validator';

/**
 * R5 clôture §1 — Correction d'un paiement (contre-écriture RG-015, jamais une
 * réécriture) : le montant qui AURAIT dû être enregistré. Le service calcule le
 * delta et crée un Payment(type=ajustement) portant la différence — l'original
 * n'est jamais modifié ni supprimé.
 */
export class CorrectPaymentDto {
  @IsNumber()
  @IsPositive()
  correctedAmount!: number;
}
