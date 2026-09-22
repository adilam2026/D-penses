import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance, round2, toNumber } from '../common/ledger/ledger.util';
import { contributeToPocket } from '../common/ledger/pocket-movements.util';
import { CloseMedicalClaimDto } from './dto/close-medical-claim.dto';
import { UpdateMedicalClaimDto } from './dto/update-medical-claim.dto';

/**
 * Refonte maquette V6B §9-11 — dossiers de remboursement mutuelle. Créés
 * automatiquement par ExpensesService.create (jamais ici) ; ce service ne gère
 * que la lecture/clôture/modification d'un dossier déjà existant. Le montant
 * remboursé n'est JAMAIS compté comme un revenu projeté avant clôture — et
 * même après, il passe par un Adjustment (jamais une IncomeOccurrence), donc
 * jamais dans total_income/la projection des revenus (cf. treasury/projection
 * util qui ne lisent jamais la table adjustment pour les revenus).
 */
@Injectable()
export class MedicalClaimsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claims = await tx.medicalClaim.findMany({
        where: { householdId },
        orderBy: { visitDate: 'desc' },
        include: { reimbursementAccount: true, allocatedSavingsPocket: true },
      });
      const enriched = claims.map((c) => ({
        ...c,
        amountEngaged: toNumber(c.amountEngaged),
        amountReimbursed: toNumber(c.amountReimbursed),
        resteACharge: round2(toNumber(c.amountEngaged) - toNumber(c.amountReimbursed)),
      }));
      const pending = enriched.filter((c) => c.status === 'en_attente');
      const summary = {
        pendingCount: pending.length,
        totalEngaged: round2(enriched.reduce((sum, c) => sum + c.amountEngaged, 0)),
        totalReimbursed: round2(enriched.reduce((sum, c) => sum + c.amountReimbursed, 0)),
      };
      return { summary, claims: enriched };
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claim = await tx.medicalClaim.findFirst({
        where: { id, householdId },
        include: { reimbursementAccount: true, allocatedSavingsPocket: true, sourceExpense: true },
      });
      if (!claim) throw new NotFoundException('Dossier introuvable');
      return {
        ...claim,
        amountEngaged: toNumber(claim.amountEngaged),
        amountReimbursed: toNumber(claim.amountReimbursed),
        resteACharge: round2(toNumber(claim.amountEngaged) - toNumber(claim.amountReimbursed)),
      };
    });
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateMedicalClaimDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claim = await tx.medicalClaim.findFirst({ where: { id, householdId } });
      if (!claim) throw new NotFoundException('Dossier introuvable');
      return tx.medicalClaim.update({
        where: { id },
        data: { label: dto.label, visitDate: dto.visitDate ? new Date(dto.visitDate) : undefined },
      });
    });
  }

  /**
   * §11 — Clôture : crée UN mouvement réel positif (Adjustment, jamais un
   * revenu) sur le compte choisi, affecte éventuellement le montant à une
   * enveloppe (versement réel, jamais une dépense), enregistre le montant
   * réellement reçu, calcule reste_à_charge, clôture le dossier. Statut final :
   * 'cloture' si intégralement remboursé, 'partiellement_rembourse' sinon —
   * dans les deux cas le dossier sort de "en attente" (action terminale, comme
   * le bouton unique "Clôturer" de la maquette).
   */
  async close(userId: string, householdId: string, id: string, dto: CloseMedicalClaimDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claim = await tx.medicalClaim.findFirst({ where: { id, householdId } });
      if (!claim) throw new NotFoundException('Dossier introuvable');
      if (claim.status !== 'en_attente') {
        throw new BadRequestException('Ce dossier est déjà clôturé');
      }

      const account = await tx.financialAccount.findFirst({ where: { id: dto.reimbursementAccountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
      if (account.status !== 'actif') {
        throw new BadRequestException(`Le compte « ${account.name} » est archivé`);
      }

      const reimbursementDate = dto.reimbursementDate ? new Date(dto.reimbursementDate) : new Date();

      const adjustment = await tx.adjustment.create({
        data: {
          accountId: dto.reimbursementAccountId,
          amount: dto.amountReceived,
          reason: `Remboursement mutuelle — ${claim.label}`,
          type: 'autre',
          createdById: userId,
          occurredAt: reimbursementDate,
        },
      });

      if (dto.allocatedSavingsPocketId) {
        const pocket = await tx.savingsPocket.findFirst({ where: { id: dto.allocatedSavingsPocketId, householdId } });
        if (!pocket) throw new NotFoundException('Enveloppe introuvable dans ce foyer');
        // backed_by_account : l'argent est déjà dans le compte lié (RG-073/086),
        // aucun PocketMovement à créer — computePocketCurrentAmount le lit
        // directement depuis le solde du compte.
        if (pocket.allocationMode === 'virtual_allocation') {
          await contributeToPocket(tx, 'savings_pocket', pocket.id, pocket.allocationMode, {
            amount: dto.amountReceived,
            date: reimbursementDate,
            intentionLabel: `Remboursement mutuelle — ${claim.label}`,
            confirmed: true,
            recordedByUserId: userId,
          });
        }
      }

      const amountReimbursed = round2(toNumber(claim.amountReimbursed) + dto.amountReceived);
      const amountEngaged = toNumber(claim.amountEngaged);
      const status = amountReimbursed >= amountEngaged ? 'cloture' : 'partiellement_rembourse';

      const updated = await tx.medicalClaim.update({
        where: { id },
        data: {
          amountReimbursed,
          reimbursementDate,
          reimbursementAccountId: dto.reimbursementAccountId,
          allocatedSavingsPocketId: dto.allocatedSavingsPocketId,
          status,
        },
      });

      return {
        claim: {
          ...updated,
          amountEngaged,
          amountReimbursed,
          resteACharge: round2(amountEngaged - amountReimbursed),
        },
        adjustment,
        soldeCourant: await getAccountBalance(tx, dto.reimbursementAccountId),
      };
    });
  }
}
