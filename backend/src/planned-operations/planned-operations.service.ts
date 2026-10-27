import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma, ResponsibleSource } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation, computePlannedOperationAlreadyPaid, alreadyPaidGuardMessage } from '../common/ledger/ledger.util';
import { ensurePlannedOccurrences, resolveOccurrenceIdentity } from '../common/ledger/recurrence.util';
import { resolveFallbackCategoryId } from '../categories/categories.service';

export interface UpdatePlannedOperationInput {
  expectedAmount?: string;
  expectedDate?: string;
  label?: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit du compte/sous-compte ci-dessus, aucun effet ledger. */
  responsibleMemberId?: string;
  /** Lot "refonte Planning/À faire" §1 — ignoré si responsibleMemberId est omis (cf. service#update : ne touche alors jamais la source existante). */
  responsibleSource?: ResponsibleSource;
  includeInTodo?: boolean;
}

export interface RealizePlannedOperationInput {
  actualAmount: string;
  actualDate?: string;
  label?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

/**
 * Source RÉELLE de ce paiement (lot "choisir la source au moment du
 * paiement") — si l'appelant fournit sourceAccountId, la paire
 * (account+subaccount) qu'il a choisie remplace ENTIÈREMENT celle de
 * l'échéance (jamais une fusion champ par champ : omettre subaccountId
 * signifie explicitement "compte principal direct", pas "garder l'ancien
 * sous-compte"). Sans override, la source PRÉVUE de l'échéance est utilisée
 * telle quelle — comportement historique inchangé. Ne modifie jamais la
 * planned_operation elle-même : purement les params de CETTE opération réelle.
 */
function resolvePaymentShape(
  planned: { sourceAccountId: string | null; sourceSubaccountId: string | null; destinationAccountId: string | null; destinationSubaccountId: string | null },
  dto: { sourceAccountId?: string; sourceSubaccountId?: string; destinationAccountId?: string; destinationSubaccountId?: string },
) {
  return {
    sourceAccountId: dto.sourceAccountId ?? planned.sourceAccountId ?? undefined,
    sourceSubaccountId: dto.sourceAccountId ? dto.sourceSubaccountId : (planned.sourceSubaccountId ?? undefined),
    destinationAccountId: dto.destinationAccountId ?? planned.destinationAccountId ?? undefined,
    destinationSubaccountId: dto.destinationAccountId ? dto.destinationSubaccountId : (planned.destinationSubaccountId ?? undefined),
  };
}

export interface CreatePlannedOperationInput {
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  label: string;
  expectedDate: string;
  expectedAmount: string;
  categoryId?: string;
  recurrenceRuleId?: string;
  financialPlanItemId?: string;
  financialPlanDeadlineId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit du compte/sous-compte ci-dessus, aucun effet ledger. */
  responsibleMemberId?: string;
  /** Lot "refonte Planning/À faire" §1 — cf. UpdatePlannedOperationInput. */
  responsibleSource?: ResponsibleSource;
  /** Si omis : OUI pour un versement (SAVINGS_CONTRIBUTION), NON pour une dépense (EXPENSE) — jamais pour un revenu (INCOME, toujours exclu de "À faire"). */
  includeInTodo?: boolean;
}

/** Règle par défaut "Ajouter à mes actions" (§7) quand non fournie explicitement — jamais appliquée rétroactivement, uniquement à la création. */
function defaultIncludeInTodo(kind: CreatePlannedOperationInput['kind']): boolean {
  return kind === 'SAVINGS_CONTRIBUTION';
}

@Injectable()
export class PlannedOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      try {
        const categoryId = dto.categoryId ?? (dto.kind === 'EXPENSE' ? await resolveFallbackCategoryId(tx, householdId) : undefined);
        return await tx.plannedOperation.create({
          data: {
            householdId,
            kind: dto.kind,
            label: dto.label,
            expectedDate: new Date(dto.expectedDate),
            expectedAmount: new Prisma.Decimal(dto.expectedAmount),
            categoryId: categoryId ?? undefined,
            recurrenceRuleId: dto.recurrenceRuleId,
            financialPlanItemId: dto.financialPlanItemId,
            financialPlanDeadlineId: dto.financialPlanDeadlineId,
            sourceAccountId: dto.sourceAccountId,
            sourceSubaccountId: dto.sourceSubaccountId,
            destinationAccountId: dto.destinationAccountId,
            destinationSubaccountId: dto.destinationSubaccountId,
            responsibleMemberId: dto.responsibleMemberId,
            // Lot "refonte Planning/À faire" §1 — défaut MANUAL (jamais AUTO
            // implicite) : seul le mobile, en posant explicitement ce flag
            // quand l'utilisateur n'a jamais touché le champ Responsable,
            // rend une échéance éligible à la cascade automatique future.
            responsibleSource: dto.responsibleSource ?? 'MANUAL',
            includeInTodo: dto.includeInTodo ?? defaultIncludeInTodo(dto.kind),
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Une échéance existe déjà pour cette règle de récurrence à cette date');
        }
        throw err;
      }
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      // Fenêtre glissante toujours à jour (même logique que Planning) — sinon
      // "À faire" (Accueil) peut rester figé si l'utilisateur n'ouvre jamais Planning.
      await ensurePlannedOccurrences(tx, householdId);
      return tx.plannedOperation.findMany({ where: { householdId }, orderBy: { expectedDate: 'asc' } });
    });
  }

  /** Réalise une échéance prévue : crée la financial_operation réelle (montant possiblement différent) et clôt le prévu. */
  async realize(userId: string, householdId: string, id: string, dto: RealizePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const operation = await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: planned.kind as unknown as OperationKind,
        label: dto.label ?? planned.label,
        date: dto.actualDate ? new Date(dto.actualDate) : planned.expectedDate,
        amount: new Prisma.Decimal(dto.actualAmount),
        categoryId: planned.categoryId,
        plannedOperationId: id,
        ...resolvePaymentShape(planned, dto),
      });

      await tx.plannedOperation.update({
        where: { id },
        data: { status: 'REALIZED', realizedOperationId: operation.id },
      });

      return operation;
    });
  }

  /**
   * Paiement partiel (Planning, appui long, §correction "paiements partiels
   * successifs") — enregistre le montant réellement payé maintenant comme
   * une vraie opération réelle LIÉE à l'échéance (planned_operation_id),
   * SANS jamais clore l'échéance ni muter son expected_amount (qui reste le
   * "prévu" d'origine, constant). Le "déjà payé"/"reste" sont dérivés en
   * sommant toutes les opérations liées (cf. computeAlreadyPaid) — jamais
   * stockés. Le reste continue d'apparaître comme à venir (même échéance,
   * toujours PENDING), et peut recevoir d'AUTRES paiements partiels, chacun
   * avec sa propre source — jamais de blocage après un premier paiement
   * partiel. Si le reste est payé plus tard via `realize`, l'échéance
   * devient entièrement réalisée.
   */
  async partialRealize(userId: string, householdId: string, id: string, dto: RealizePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const partialAmount = new Prisma.Decimal(dto.actualAmount);
      if (partialAmount.lte(0)) throw new BadRequestException('Le montant payé doit être positif');

      const alreadyPaid = await computePlannedOperationAlreadyPaid(tx, id);
      const remaining = planned.expectedAmount.sub(alreadyPaid);
      if (partialAmount.gte(remaining)) {
        throw new BadRequestException('Pour régler le reste en totalité, utilisez le paiement total plutôt que le paiement partiel');
      }

      return insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: planned.kind as unknown as OperationKind,
        label: dto.label ?? planned.label,
        date: dto.actualDate ? new Date(dto.actualDate) : new Date(),
        amount: partialAmount,
        categoryId: planned.categoryId,
        plannedOperationId: id,
        ...resolvePaymentShape(planned, dto),
      });
    });
  }

  async cancel(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');
      return tx.plannedOperation.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
  }

  /**
   * Modifier UNE occurrence ("cette échéance uniquement", appui long sur une
   * case encore prévue, ou échéance ponctuelle) — ex. Internet d'octobre 350
   * -> 420. Ne touche jamais la règle de récurrence source ni les autres
   * occurrences ; refuse si l'occurrence n'est plus PENDING.
   *
   * Occurrence récurrente : toute modification (y compris de DATE) se fait
   * sur place. L'identité logique d'une occurrence est (règle, version, n°),
   * jamais sa date : la déplacer ne libère donc rien, et le moteur ne la
   * recrée jamais à sa date théorique. Elle est marquée manuallyEdited. La
   * règle de récurrence et toutes les autres occurrences restent intactes.
   *
   * Lot "refonte Planning/À faire" §20-24 — MODIFIER une échéance déjà payée
   * (REALIZED, ou PENDING avec paiement(s) partiel(s)) est maintenant
   * autorisé directement ici (seul CANCELLED reste refusé) : ouvrir le
   * formulaire, y changer des champs localement, ne mute RIEN avant cet
   * appel — jamais un unrealize() déclenché par la simple navigation.
   * Augmenter expectedAmount au-delà du déjà-payé d'une occurrence REALIZED
   * la REBASCULE en PENDING (le paiement déjà enregistré reste intact,
   * jamais renversé) ; l'égaler la laisse REALIZED. Le garde-fou "jamais
   * sous ce qui est déjà payé" (alreadyPaidGuardMessage) s'applique dans les
   * deux cas, PENDING ou REALIZED.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status === 'CANCELLED') throw new BadRequestException('Cette échéance a déjà été annulée');

      const alreadyPaid = await computePlannedOperationAlreadyPaid(tx, id);

      // §23/§24 "Ne jamais créer une incohérence comptable silencieuse" — un
      // montant prévu ne peut jamais descendre sous ce qui a déjà été payé
      // (paiements partiels compris, échéance REALIZED comprise) : 300 déjà
      // payés sur 1000 -> 1200/800 autorisés, 200 refusé avec le message exact.
      if (dto.expectedAmount !== undefined) {
        const newAmount = new Prisma.Decimal(dto.expectedAmount);
        if (newAmount.lt(alreadyPaid)) throw new BadRequestException(alreadyPaidGuardMessage(alreadyPaid));
      }

      // Lot "refonte Planning/À faire" §1 — un changement de responsable est
      // MANUAL par défaut (protégé des cascades futures) sauf si le mobile
      // pose explicitement AUTO ; aucun champ envoyé -> aucune source écrasée.
      const responsibleSourcePatch: ResponsibleSource | undefined =
        dto.responsibleMemberId !== undefined ? dto.responsibleSource ?? 'MANUAL' : undefined;

      const newExpectedDate = dto.expectedDate !== undefined ? new Date(dto.expectedDate) : undefined;
      const changesDate = !!newExpectedDate && newExpectedDate.getTime() !== planned.expectedDate.getTime();

      // Échéance récurrente : la modifier (date comprise) se fait SUR PLACE —
      // elle garde sa règle, son n° et sa version, et devient « modifiée
      // manuellement » (sa date ne sera plus jamais recalée automatiquement).
      // L'identité logique étant le n°, et non la date, le moteur ne recrée
      // jamais l'occurrence à sa date théorique : plus de ligne détachée ni
      // d'annulation technique à l'ancienne date.
      const isRecurring = !!planned.recurrenceRuleId;
      if (changesDate && isRecurring && alreadyPaid.gt(0)) {
        // Inchangé : la date d'une échéance ayant déjà un paiement ne se change pas silencieusement.
        throw new BadRequestException(
          "Impossible de changer la date d'une échéance ayant déjà un paiement enregistré. Modifiez le montant, ou annulez d'abord le paiement.",
        );
      }
      const touchesOccurrence = Object.values(dto).some((v) => v !== undefined);
      const identity = isRecurring && touchesOccurrence ? await resolveOccurrenceIdentity(tx, planned) : null;
      const identityPatch =
        identity && planned.occurrenceIndex === null && identity.occurrenceIndex !== null
          ? { occurrenceIndex: identity.occurrenceIndex, seriesVersion: identity.seriesVersion }
          : {};

      // §20/§24 — une occurrence REALIZED dont le prévu est augmenté
      // au-delà du déjà-payé redevient PENDING (reste à exécuter) ; le
      // paiement déjà enregistré (realizedOperationId) n'est jamais
      // renversé, seulement détaché de "la seule opération de clôture" —
      // exactement comme une échéance partiellement payée.
      const resultingAmount = dto.expectedAmount !== undefined ? new Prisma.Decimal(dto.expectedAmount) : planned.expectedAmount;
      const becomesPending = planned.status === 'REALIZED' && resultingAmount.gt(alreadyPaid);

      return tx.plannedOperation.update({
        where: { id },
        data: {
          expectedAmount: dto.expectedAmount !== undefined ? new Prisma.Decimal(dto.expectedAmount) : undefined,
          expectedDate: newExpectedDate,
          label: dto.label,
          categoryId: dto.categoryId,
          // Paire source/destination traitée comme un tout (jamais fusionnée
          // champ par champ) : fournir *AccountId sans *SubaccountId signifie
          // explicitement "compte principal direct", jamais "garder l'ancien
          // sous-compte" d'un compte différent.
          sourceAccountId: dto.sourceAccountId,
          sourceSubaccountId: dto.sourceAccountId !== undefined ? (dto.sourceSubaccountId ?? null) : undefined,
          destinationAccountId: dto.destinationAccountId,
          destinationSubaccountId: dto.destinationAccountId !== undefined ? (dto.destinationSubaccountId ?? null) : undefined,
          // Lot "À faire" — RESPONSABLE ≠ SOURCE : jamais déduit des champs ci-dessus.
          responsibleMemberId: dto.responsibleMemberId,
          responsibleSource: responsibleSourcePatch,
          includeInTodo: dto.includeInTodo,
          status: becomesPending ? 'PENDING' : undefined,
          realizedOperationId: becomesPending ? null : undefined,
          ...identityPatch,
          manuallyEdited: isRecurring && touchesOccurrence ? true : undefined,
        },
      });
    });
  }

  /**
   * Annuler un paiement déjà réalisé (appui long sur une case verte, "Annuler
   * le paiement") — utilise exclusivement le mécanisme de renversement déjà
   * validé (reversalOfOperationId) : NE supprime JAMAIS la transaction
   * d'origine, crée une contre-écriture, et remet l'occurrence à PENDING avec
   * son montant prévu d'origine (le montant réel réalisé est perdu, comme
   * pour toute annulation — l'occurrence redevient une échéance à réaliser).
   */
  async unrealize(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'REALIZED' || !planned.realizedOperationId) {
        throw new BadRequestException("Cette échéance n'est pas réalisée, impossible de l'annuler");
      }

      const original = await tx.financialOperation.findUnique({ where: { id: planned.realizedOperationId } });
      if (!original || original.householdId !== householdId) throw new NotFoundException('Transaction réalisée introuvable');

      await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: `Annulation — ${original.label}`,
        date: new Date(),
        amount: original.amount,
        categoryId: original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        reversalOfOperationId: original.id,
        reversalReason: 'Annulation depuis le Planning',
        // Lot "paiements partiels successifs" : garde le renversement lié à
        // la même échéance que l'opération d'origine, pour qu'il nette
        // correctement dans la somme "déjà payé" (cf. computeAlreadyPaid) —
        // si des paiements partiels antérieurs existent, ils restent comptés.
        plannedOperationId: original.plannedOperationId,
      });

      return tx.plannedOperation.update({
        where: { id },
        data: { status: 'PENDING', realizedOperationId: null },
      });
    });
  }
}
