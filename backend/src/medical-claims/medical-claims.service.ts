import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';

@Injectable()
export class MedicalClaimsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /**
   * Liste des dossiers santé — Engagé/Remboursé/Reste/Statut sont TOUJOURS
   * dérivés (jamais stockés), cf. commentaire du modèle MedicalClaim. Un
   * dossier passe "clos" dès que le remboursé atteint l'engagé.
   */
  async list(userId: string, householdId: string, subaccountId?: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claims = await tx.medicalClaim.findMany({
        where: { householdId, ...(subaccountId ? { subaccountId } : {}) },
        include: { reimbursements: true },
        orderBy: { createdAt: 'desc' },
      });
      return claims.map((claim) => this.toDto(claim));
    });
  }

  private toDto(claim: Prisma.MedicalClaimGetPayload<{ include: { reimbursements: true } }>) {
    const amountReimbursed = claim.reimbursements.reduce((sum, r) => sum.add(r.amount), new Prisma.Decimal(0));
    const reste = claim.amountEngaged.sub(amountReimbursed);
    const status: 'PENDING' | 'CLOSED' = claim.closedAt ? 'CLOSED' : 'PENDING';
    return { ...claim, amountReimbursed, reste, status };
  }

  /** "J'ai reçu un remboursement" (§10 maquette) — crée l'opération MEDICAL_REIMBURSEMENT + la ligne dédiée, clôt le dossier si intégralement remboursé. */
  async addReimbursement(
    userId: string,
    householdId: string,
    claimId: string,
    dto: { amount: string; date: string; destinationAccountId: string; allocationSubaccountId?: string },
  ) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claim = await tx.medicalClaim.findUnique({ where: { id: claimId }, include: { reimbursements: true } });
      if (!claim || claim.householdId !== householdId) throw new NotFoundException('Dossier introuvable');

      const operation = await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: 'MEDICAL_REIMBURSEMENT',
        label: `Remboursement mutuelle — ${claim.label}`,
        date: new Date(dto.date),
        amount: new Prisma.Decimal(dto.amount),
        destinationAccountId: dto.destinationAccountId,
        destinationSubaccountId: dto.allocationSubaccountId,
      });

      await tx.medicalReimbursement.create({
        data: {
          claimId: claim.id,
          amount: new Prisma.Decimal(dto.amount),
          date: new Date(dto.date),
          operationId: operation.id,
          allocationSubaccountId: dto.allocationSubaccountId,
        },
      });

      const totalReimbursed = [...claim.reimbursements, { amount: new Prisma.Decimal(dto.amount) }].reduce((sum, r) => sum.add(r.amount), new Prisma.Decimal(0));
      if (!claim.closedAt && totalReimbursed.gte(claim.amountEngaged)) {
        await tx.medicalClaim.update({ where: { id: claim.id }, data: { closedAt: new Date() } });
      }

      const updated = await tx.medicalClaim.findUniqueOrThrow({ where: { id: claim.id }, include: { reimbursements: true } });
      return this.toDto(updated);
    });
  }

  /**
   * Clôture manuelle (§8) — permet de considérer un dossier terminé même si
   * remboursé < engagé (reste à charge non remboursé). Ne modifie JAMAIS les
   * montants engagé/remboursé, seul closed_at est renseigné.
   */
  async closeManually(userId: string, householdId: string, claimId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const claim = await tx.medicalClaim.findUnique({ where: { id: claimId }, include: { reimbursements: true } });
      if (!claim || claim.householdId !== householdId) throw new NotFoundException('Dossier introuvable');
      if (claim.closedAt) return this.toDto(claim);

      const updated = await tx.medicalClaim.update({ where: { id: claimId }, data: { closedAt: new Date() }, include: { reimbursements: true } });
      return this.toDto(updated);
    });
  }
}
