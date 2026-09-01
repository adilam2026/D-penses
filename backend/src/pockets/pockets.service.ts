import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computePocketCurrentAmount } from '../common/ledger/provision.util';
import { contributeToPocket, withdrawFromPocket, confirmPocketMovement } from '../common/ledger/pocket-movements.util';
import { CreateSavingsPocketDto } from './dto/create-savings-pocket.dto';
import { UpdateSavingsPocketDto } from './dto/update-savings-pocket.dto';
import { ContributeDto } from './dto/contribute.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { ConfirmMovementDto } from './dto/confirm-movement.dto';

/**
 * SavingsPocket (docs/02-modele-metier.md §C.5/E.5bis). Une poche N'EST JAMAIS un
 * compte bancaire (§2) : current_amount est toujours dérivé (RG-071), jamais stocké.
 * RG-047 : protection par défaut de l'épargne enfant — structurellement, une
 * SavingsPocket n'a AUCUNE relation vers une Deadline (contrairement à Provision),
 * elle ne peut donc jamais être mobilisée automatiquement pour couvrir une charge du
 * foyer — la protection n'est donc pas un filtre appliqué par un moteur, mais une
 * garantie de construction (cf. TEST 16).
 */
@Injectable()
export class PocketsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateSavingsPocketDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      if (dto.allocationMode === 'backed_by_account') {
        if (!dto.linkedAccountId) {
          throw new BadRequestException('linkedAccountId est requis quand allocationMode = backed_by_account (RG-072)');
        }
        const account = await tx.financialAccount.findFirst({ where: { id: dto.linkedAccountId, householdId } });
        if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
      } else if (dto.linkedAccountId) {
        throw new BadRequestException('linkedAccountId doit être absent quand allocationMode = virtual_allocation (RG-071)');
      }

      // RG-047 : protection par défaut si épargne enfant avec versement récurrent déclaré —
      // reste explicitement modifiable ensuite (PATCH), jamais recalculée automatiquement.
      const isProtected = dto.isProtected ?? Boolean(dto.beneficiaryChildId && dto.hasRecurringContribution);

      const pocket = await tx.savingsPocket.create({
        data: {
          householdId,
          name: dto.name,
          ownerUserId: dto.ownerUserId,
          beneficiaryChildId: dto.beneficiaryChildId,
          allocationMode: dto.allocationMode,
          linkedAccountId: dto.allocationMode === 'backed_by_account' ? dto.linkedAccountId : null,
          targetAmount: dto.targetAmount,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
          isProtected,
        },
      });
      return this.withCurrentAmount(tx, pocket);
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pockets = await tx.savingsPocket.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } });
      return Promise.all(pockets.map((p) => this.withCurrentAmount(tx, p)));
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pocket = await tx.savingsPocket.findFirst({ where: { id, householdId } });
      if (!pocket) throw new NotFoundException('Poche introuvable');
      return this.withCurrentAmount(tx, pocket);
    });
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateSavingsPocketDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pocket = await tx.savingsPocket.findFirst({ where: { id, householdId } });
      if (!pocket) throw new NotFoundException('Poche introuvable');
      const updated = await tx.savingsPocket.update({
        where: { id },
        data: {
          name: dto.name,
          targetAmount: dto.targetAmount,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
          isProtected: dto.isProtected,
        },
      });
      return this.withCurrentAmount(tx, updated);
    });
  }

  async contribute(userId: string, householdId: string, id: string, dto: ContributeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pocket = await tx.savingsPocket.findFirst({ where: { id, householdId } });
      if (!pocket) throw new NotFoundException('Poche introuvable');
      const movement = await contributeToPocket(tx, 'savings_pocket', id, pocket.allocationMode, {
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : undefined,
        intentionLabel: dto.intentionLabel,
        confirmed: dto.confirmed ?? true,
        recordedByUserId: userId,
      });
      return { movement, pocket: await this.withCurrentAmount(tx, pocket) };
    });
  }

  async withdraw(userId: string, householdId: string, id: string, dto: WithdrawDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pocket = await tx.savingsPocket.findFirst({ where: { id, householdId } });
      if (!pocket) throw new NotFoundException('Poche introuvable');
      const movement = await withdrawFromPocket(tx, 'savings_pocket', id, pocket.allocationMode, {
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : undefined,
        intentionLabel: dto.intentionLabel,
        recordedByUserId: userId,
      });
      return { movement, pocket: await this.withCurrentAmount(tx, pocket) };
    });
  }

  async listMovements(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const pocket = await tx.savingsPocket.findFirst({ where: { id, householdId } });
      if (!pocket) throw new NotFoundException('Poche introuvable');
      return tx.pocketMovement.findMany({ where: { pocketType: 'savings_pocket', savingsPocketId: id }, orderBy: { plannedDate: 'desc' } });
    });
  }

  async confirmMovement(userId: string, householdId: string, movementId: string, dto: ConfirmMovementDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return confirmPocketMovement(tx, movementId, dto.actualDate ? new Date(dto.actualDate) : undefined, dto.actualAmount);
    });
  }

  private async withCurrentAmount(tx: ReturnType<RlsContextService['getClient']>, pocket: { id: string; allocationMode: 'virtual_allocation' | 'backed_by_account'; linkedAccountId: string | null }) {
    const currentAmount = await computePocketCurrentAmount(tx, 'savings_pocket', pocket.id, pocket.allocationMode, pocket.linkedAccountId);
    return { ...pocket, currentAmount };
  }
}
