import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance, getDeadlineBalance, toNumber } from '../common/ledger/ledger.util';
import { recalcFinancialStatus } from '../common/ledger/deadline-status.util';
import { computePocketCurrentAmount } from '../common/ledger/provision.util';
import { withdrawFromPocket, contributeToPocket } from '../common/ledger/pocket-movements.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CorrectPaymentDto } from './dto/correct-payment.dto';

/**
 * Payment (docs/02-modele-metier.md §E.3, RG-015). amount toujours > 0, le
 * signe comptable (impact sur reste_a_payer ET sur solde_courant) est déduit
 * du type par le moteur — jamais saisi, jamais recopié : les deux vues
 * (deadline_with_balance, ledger_entry) portent chacune la seule copie de
 * leur propre formule de signe (IF-20, les deux ne sont jamais confondues).
 *
 * funding_source = provision (RG-095/§18-21 Lot 6) : « Payer avec Provision » reste
 * une opération atomique unique, toujours dans la MÊME transaction rlsContext.run —
 * Payment + PocketMovement retrait (si virtual_allocation) + recalcul du statut
 * financier, jamais d'état intermédiaire incohérent (§18/TEST 12).
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, deadlineId: string, dto: CreatePaymentDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      if (deadline.financialStatus === 'annulee') {
        throw new BadRequestException('Impossible d\'enregistrer un paiement sur une échéance annulée');
      }

      // §19 : un compte physique réel reste TOUJOURS obligatoire, même funding_source=provision
      // (une Provision n'est jamais un compte bancaire) — l'UX peut le pré-remplir, jamais l'omettre.
      const account = await tx.financialAccount.findFirst({ where: { id: dto.accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
      // R5 clôture §2 — jamais un NOUVEAU paiement sur un compte archivé.
      if (account.status !== 'actif') {
        throw new BadRequestException(`Le compte « ${account.name} » est archivé — réactivez-le pour l'utiliser`);
      }

      const type = dto.type ?? 'paiement';
      if (type === 'ajustement' && !dto.direction) {
        throw new BadRequestException('direction est obligatoire pour un ajustement (RG-015)');
      }
      if (type !== 'ajustement' && dto.direction) {
        throw new BadRequestException('direction est réservé aux paiements de type ajustement (RG-015)');
      }
      const fundingSource = dto.fundingSource ?? 'compte';

      if (fundingSource === 'provision') {
        if (!dto.provisionId) throw new BadRequestException('provisionId est requis quand fundingSource = provision (RG-095)');
        const provision = await tx.provision.findFirst({ where: { id: dto.provisionId, householdId } });
        if (!provision) throw new NotFoundException('Provision introuvable dans ce foyer');
        if (deadline.provisionId !== provision.id) {
          throw new BadRequestException("Cette Provision n'est pas liée à cette échéance (RG-095) — liez-la d'abord");
        }
        if (provision.allocationMode === 'backed_by_account' && provision.linkedAccountId !== dto.accountId) {
          throw new BadRequestException('Une provision backed_by_account ne peut être payée que depuis son compte dédié (RG-095.3)');
        }

        const currentAmount = await computePocketCurrentAmount(tx, 'provision', provision.id, provision.allocationMode, provision.linkedAccountId);
        if (dto.amount > currentAmount) {
          // §21 : jamais un solde de poche négatif silencieux — refus propre avec le montant disponible indiqué.
          throw new BadRequestException(
            `Provision insuffisante : ${currentAmount} DH disponibles pour financer ${dto.amount} DH — réduisez le montant ou complétez avec un second paiement depuis un compte (RG-096)`,
          );
        }
      } else if (dto.provisionId) {
        throw new BadRequestException('provisionId est réservé à fundingSource = provision');
      }

      const payment = await tx.payment.create({
        data: {
          deadlineId,
          amount: dto.amount,
          paidDate: dto.paidDate ? new Date(dto.paidDate) : new Date(),
          accountId: dto.accountId,
          type,
          direction: dto.direction,
          fundingSource,
          provisionId: fundingSource === 'provision' ? dto.provisionId : undefined,
          recordedById: userId,
          notes: dto.notes,
        },
      });

      // RG-095.2 : virtual_allocation → retrait PocketMovement du même montant, dans la même
      // transaction — jamais l'un sans l'autre (IF-19). RG-095.3 : backed_by_account → rien de
      // plus, le solde baisse naturellement via G.1 (le Payment débite déjà linkedAccountId).
      if (fundingSource === 'provision' && dto.provisionId) {
        const provision = await tx.provision.findUniqueOrThrow({ where: { id: dto.provisionId } });
        if (provision.allocationMode === 'virtual_allocation') {
          await withdrawFromPocket(tx, 'provision', provision.id, provision.allocationMode, {
            amount: dto.amount,
            date: payment.paidDate,
            intentionLabel: `Paiement ${deadlineId}`,
            recordedByUserId: userId,
          });
        }
      }

      const updatedDeadline = await recalcFinancialStatus(tx, deadlineId);
      const balance = await getDeadlineBalance(tx, deadlineId);

      return {
        payment,
        deadline: { ...updatedDeadline, resteAPayer: balance?.resteAPayer ?? null },
        soldeCourant: await getAccountBalance(tx, dto.accountId),
      };
    });
  }

  async listByDeadline(userId: string, householdId: string, deadlineId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      return tx.payment.findMany({ where: { deadlineId }, orderBy: { paidDate: 'asc' } });
    });
  }

  /**
   * R5 clôture §1 — « Corriger » un paiement (montant mal saisi) : jamais une
   * réécriture du Payment original — une contre-écriture RG-015
   * (type=ajustement, direction déduite du sens de l'écart) porte le delta.
   * Réservée aux paiements standard (type=paiement) financés depuis un compte :
   * un paiement financé par une enveloppe n'est pas corrigeable partiellement
   * ici (la re-ventilation de l'enveloppe sortirait du périmètre sûr de cette
   * clôture) — seule l'Annulation complète (reverse) est proposée pour ce cas.
   */
  async correct(userId: string, householdId: string, deadlineId: string, paymentId: string, dto: CorrectPaymentDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.payment.findFirst({
        where: { id: paymentId, deadlineId, deadline: { chargePlan: { householdId } } },
      });
      if (!original) throw new NotFoundException('Paiement introuvable');
      if (original.type !== 'paiement') {
        throw new BadRequestException('Seul un paiement standard peut être corrigé (jamais une correction déjà appliquée)');
      }
      if (original.fundingSource === 'provision') {
        throw new BadRequestException(
          "Un paiement financé par une enveloppe ne peut pas être corrigé partiellement — utilisez Annuler puis un nouveau paiement",
        );
      }
      if (original.isHistoricalImport) {
        // R6.2 corrections finales §1 : un paiement de reprise historique "déjà
        // payé" n'a jamais débité de solde réel — qu'un compte historique soit
        // connu (accountId renseigné, à titre d'information) ou non. Le corriger
        // ici créerait une vraie écriture d'ajustement qui débiterait pour de
        // vrai un compte aujourd'hui — jamais pour un montant déjà réglé avant
        // la reprise de données. Modifier le montant historique passe par le
        // ChargePlan (§3).
        throw new BadRequestException(
          "Ce paiement est une reprise historique (« déjà payé ») — utilisez la modification de l'échéance pour corriger son montant",
        );
      }

      const originalAmount = toNumber(original.amount);
      const delta = round2(dto.correctedAmount - originalAmount);
      if (delta === 0) throw new BadRequestException('Le montant corrigé est identique au montant déjà enregistré');
      const direction = delta > 0 ? 'augmente_paye' : 'diminue_paye';

      const correction = await tx.payment.create({
        data: {
          deadlineId,
          amount: Math.abs(delta),
          paidDate: new Date(),
          accountId: original.accountId,
          type: 'ajustement',
          direction,
          fundingSource: 'compte',
          recordedById: userId,
          notes: `Correction du paiement du ${original.paidDate.toISOString().slice(0, 10)} (${originalAmount} DH → ${dto.correctedAmount} DH)`,
        },
      });

      const updatedDeadline = await recalcFinancialStatus(tx, deadlineId);
      const balance = await getDeadlineBalance(tx, deadlineId);
      return {
        correction,
        deadline: { ...updatedDeadline, resteAPayer: balance?.resteAPayer ?? null },
        // original.accountId est garanti non-null ici : le guard isHistoricalImport
        // ci-dessus a déjà exclu le seul cas où accountId peut être NULL (reprise
        // historique) — un paiement normal (create()) exige toujours un compte réel.
        soldeCourant: await getAccountBalance(tx, original.accountId!),
      };
    });
  }

  /**
   * R5 clôture §1 — « Annuler » un paiement entièrement erroné : jamais une
   * suppression physique — un Payment(type=remboursement) du même montant
   * inverse exactement l'effet du paiement original (reste_a_payer ET solde
   * de compte, cf. la vue ledger_entry — même formule, aucun moteur modifié).
   * Si le paiement original était financé par une enveloppe virtual_allocation,
   * le retrait est symétriquement restitué (contributeToPocket) dans la même
   * transaction — jamais un solde d'enveloppe qui resterait faussé.
   */
  async reverse(userId: string, householdId: string, deadlineId: string, paymentId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.payment.findFirst({
        where: { id: paymentId, deadlineId, deadline: { chargePlan: { householdId } } },
      });
      if (!original) throw new NotFoundException('Paiement introuvable');
      if (original.type !== 'paiement') {
        throw new BadRequestException('Seul un paiement standard peut être annulé');
      }

      const reversal = await tx.payment.create({
        data: {
          deadlineId,
          amount: original.amount,
          paidDate: new Date(),
          accountId: original.accountId,
          // R6.2 corrections finales §1 : propage le marqueur de l'original — annuler
          // un paiement de reprise historique ne doit jamais créditer pour de vrai un
          // compte qui n'avait jamais été débité pour de vrai (symétrie stricte).
          isHistoricalImport: original.isHistoricalImport,
          type: 'remboursement',
          fundingSource: original.fundingSource,
          provisionId: original.provisionId,
          recordedById: userId,
          notes: `Annulation du paiement du ${original.paidDate.toISOString().slice(0, 10)}`,
        },
      });

      if (original.fundingSource === 'provision' && original.provisionId) {
        const provision = await tx.provision.findUniqueOrThrow({ where: { id: original.provisionId } });
        if (provision.allocationMode === 'virtual_allocation') {
          await contributeToPocket(tx, 'provision', provision.id, 'virtual_allocation', {
            amount: toNumber(original.amount),
            date: reversal.paidDate,
            intentionLabel: `Annulation paiement ${original.id}`,
            confirmed: true,
            recordedByUserId: userId,
          });
        }
      }

      const updatedDeadline = await recalcFinancialStatus(tx, deadlineId);
      const balance = await getDeadlineBalance(tx, deadlineId);
      return {
        reversal,
        deadline: { ...updatedDeadline, resteAPayer: balance?.resteAPayer ?? null },
        // R6.2 corrections finales §1 : un paiement de reprise historique n'a jamais
        // débité de solde réel (même avec un compte historique connu) — jamais un
        // soldeCourant qui laisserait croire que cette action a changé un solde réel.
        soldeCourant: !original.isHistoricalImport && original.accountId ? await getAccountBalance(tx, original.accountId) : null,
      };
    });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
