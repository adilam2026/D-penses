import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { seedDefaultFallbackCategory } from '../categories/categories.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

@Injectable()
export class HouseholdsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** Création d'un foyer. Le créateur devient admin. */
  async create(userId: string, name: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const householdId = crypto.randomUUID();
      // Le foyer n'existe pas encore : on connaît son id (généré côté application) avant
      // l'écriture, ce qui permet de fixer le contexte RLS avant l'INSERT plutôt qu'après
      // (la clause RETURNING de Prisma exige une policy SELECT satisfaite, cf. RlsContextService).
      await this.rlsContext.setHouseholdContext(householdId);
      const household = await tx.household.create({ data: { id: householdId, name } });
      await tx.householdMembership.create({
        data: { householdId: household.id, userId, role: 'admin' },
      });
      await seedDefaultFallbackCategory(tx, household.id);
      return household;
    });
  }

  async getMine(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const household = await tx.household.findUnique({
        where: { id: householdId },
        include: {
          memberships: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, color: true } } } },
        },
      });
      if (!household) throw new NotFoundException('Foyer introuvable');
      return household;
    });
  }

  /** Seul un admin peut inviter (droit non financier mais structurant). */
  async createInvite(userId: string, householdId: string, role: 'admin' | 'member' | 'read_only' = 'admin') {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const membership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId, userId } },
      });
      if (!membership || membership.role !== 'admin') {
        throw new ForbiddenException("Seul un administrateur du foyer peut créer une invitation");
      }
      const code = crypto.randomBytes(6).toString('base64url'); // court, facile à partager
      const invite = await tx.householdInvite.create({
        data: {
          householdId,
          code,
          role,
          createdById: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      return invite;
    });
  }

  /**
   * Rejoindre un foyer via un code d'invitation — ajoute un NOUVEAU membership.
   * Un seul foyer ACTIF à la fois (jamais deux contextes RLS simultanés) —
   * cette contrainte reste intacte. Un utilisateur déjà rattaché à un foyer
   * peut rejoindre un AUTRE foyer (changement de foyer actif) : l'ancien
   * membership n'est jamais supprimé, seul le foyer ACTIF (User.activeHouseholdId)
   * change.
   */
  async join(userId: string, code: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();

      const invite = await tx.householdInvite.findFirst({
        where: { code, usedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!invite) {
        throw new NotFoundException('Invitation invalide, déjà utilisée ou expirée');
      }

      const existingMembership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId: invite.householdId, userId } },
      });
      if (existingMembership) {
        throw new ConflictException('Vous êtes déjà membre de ce foyer');
      }

      // Marquage atomique anti-course : n'affecte une ligne que si l'invitation
      // est toujours disponible au moment de l'écriture.
      const claimed = await tx.householdInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedById: userId },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Invitation déjà utilisée entre-temps');
      }

      await tx.householdMembership.create({
        data: { householdId: invite.householdId, userId, role: invite.role },
      });

      await tx.user.update({ where: { id: userId }, data: { activeHouseholdId: invite.householdId } });

      return tx.household.findUniqueOrThrow({ where: { id: invite.householdId } });
    });
  }

  /**
   * Liste tous les foyers dont l'utilisateur est déjà membre (memberships
   * EXISTANTS, jamais une invitation), avec le foyer actif marqué — alimente
   * un sélecteur « Changer de foyer » côté mobile.
   */
  async listMemberships(userId: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const [user, memberships] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: userId }, select: { activeHouseholdId: true } }),
        tx.householdMembership.findMany({
          where: { userId },
          include: { household: { select: { id: true, name: true } } },
          orderBy: { joinedAt: 'asc' },
        }),
      ]);
      return memberships.map((m) => ({
        householdId: m.householdId,
        name: m.household.name,
        role: m.role,
        isActive: m.householdId === user.activeHouseholdId,
      }));
    });
  }

  /**
   * « Changer de foyer actif » : choisit parmi les memberships EXISTANTS de
   * l'utilisateur, JAMAIS via un code d'invitation — concept distinct de
   * join() (qui crée un nouveau membership). Seul le pointeur
   * User.activeHouseholdId change.
   */
  async switchActive(userId: string, householdId: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const membership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId, userId } },
      });
      if (!membership) {
        throw new NotFoundException("Vous n'êtes pas membre de ce foyer");
      }
      await tx.user.update({ where: { id: userId }, data: { activeHouseholdId: householdId } });
      return tx.household.findUniqueOrThrow({ where: { id: householdId } });
    });
  }
}
