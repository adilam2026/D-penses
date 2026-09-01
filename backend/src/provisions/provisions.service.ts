import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computePocketCurrentAmount, computeProvisionCoverage, computeProvisionSufficiency } from '../common/ledger/provision.util';
import { contributeToPocket, withdrawFromPocket, confirmPocketMovement } from '../common/ledger/pocket-movements.util';
import { CreateProvisionDto } from './dto/create-provision.dto';
import { UpdateProvisionDto } from './dto/update-provision.dto';
import { LinkDeadlineDto } from './dto/link-deadline.dto';
import { ContributeDto } from '../pockets/dto/contribute.dto';
import { WithdrawDto } from '../pockets/dto/withdraw.dto';
import { ConfirmMovementDto } from '../pockets/dto/confirm-movement.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

/**
 * Provision (docs/02-modele-metier.md §E.5/E.5ter, RG-090→097). Spécialisation
 * métier de poche destinée à couvrir des Deadline liées — réutilise EXCLUSIVEMENT
 * common/ledger/provision.util.ts et pocket-movements.util.ts (§9 : « ne crée pas un
 * deuxième système financier parallèle »).
 */
@Injectable()
export class ProvisionsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateProvisionDto) {
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

      const provision = await tx.provision.create({
        data: {
          householdId,
          name: dto.name,
          allocationMode: dto.allocationMode,
          linkedAccountId: dto.allocationMode === 'backed_by_account' ? dto.linkedAccountId : null,
          isFlexible: dto.isFlexible ?? true,
        },
      });
      return this.detailOnTx(tx, provision.id);
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provisions = await tx.provision.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } });
      return Promise.all(provisions.map((p) => this.detailOnTx(tx, p.id)));
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      return this.detailOnTx(tx, id);
    });
  }

  /** currentAmount + couverture (RG-090) sur la totalité des Deadline liées ouvertes. */
  private async detailOnTx(tx: TxClient, id: string) {
    const provision = await tx.provision.findUniqueOrThrow({ where: { id } });
    const currentAmount = await computePocketCurrentAmount(tx, 'provision', id, provision.allocationMode, provision.linkedAccountId);
    const coverage = await computeProvisionCoverage(tx, id);
    return { ...provision, currentAmount, coverage: coverage.items };
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateProvisionDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      await tx.provision.update({ where: { id }, data: { name: dto.name, isFlexible: dto.isFlexible } });
      return this.detailOnTx(tx, id);
    });
  }

  async contribute(userId: string, householdId: string, id: string, dto: ContributeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      const movement = await contributeToPocket(tx, 'provision', id, provision.allocationMode, {
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : undefined,
        intentionLabel: dto.intentionLabel,
        confirmed: dto.confirmed ?? true,
        recordedByUserId: userId,
      });
      return { movement, provision: await this.detailOnTx(tx, id) };
    });
  }

  async withdraw(userId: string, householdId: string, id: string, dto: WithdrawDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      const movement = await withdrawFromPocket(tx, 'provision', id, provision.allocationMode, {
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : undefined,
        intentionLabel: dto.intentionLabel,
        recordedByUserId: userId,
      });
      return { movement, provision: await this.detailOnTx(tx, id) };
    });
  }

  async listMovements(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      return tx.pocketMovement.findMany({ where: { pocketType: 'provision', provisionId: id }, orderBy: { plannedDate: 'desc' } });
    });
  }

  async confirmMovement(userId: string, householdId: string, movementId: string, dto: ConfirmMovementDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return confirmPocketMovement(tx, movementId, dto.actualDate ? new Date(dto.actualDate) : undefined, dto.actualAmount);
    });
  }

  /** RG-032bis/RG-032ter — suffisance temporelle, date de référence injectable (§22). */
  async sufficiency(userId: string, householdId: string, id: string, at?: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      const referenceDate = at ? new Date(at) : new Date();
      return computeProvisionSufficiency(tx, id, referenceDate);
    });
  }

  /** H-09 : une Deadline n'est jamais liée qu'à une seule Provision — le lien écrase simplement le précédent. */
  async linkDeadline(userId: string, householdId: string, id: string, dto: LinkDeadlineDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      const deadline = await tx.deadline.findFirst({ where: { id: dto.deadlineId, chargePlan: { householdId } } });
      if (!deadline) throw new NotFoundException('Échéance introuvable dans ce foyer');
      await tx.deadline.update({ where: { id: dto.deadlineId }, data: { provisionId: id } });
      return this.detailOnTx(tx, id);
    });
  }

  async unlinkDeadline(userId: string, householdId: string, id: string, deadlineId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const provision = await tx.provision.findFirst({ where: { id, householdId } });
      if (!provision) throw new NotFoundException('Provision introuvable');
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId, provisionId: id, chargePlan: { householdId } } });
      if (!deadline) throw new NotFoundException('Échéance introuvable ou non liée à cette provision');
      await tx.deadline.update({ where: { id: deadlineId }, data: { provisionId: null } });
      return this.detailOnTx(tx, id);
    });
  }
}
