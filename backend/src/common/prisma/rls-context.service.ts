import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

type TxClient = Prisma.TransactionClient;

interface RequestContext {
  tx: TxClient;
  userId: string;
  householdId: string | null;
}

/**
 * Isolation stricte par foyer (docs/04-architecture-technique-et-donnees.md §S.2, §O.1).
 *
 * Chaque requête authentifiée s'exécute à l'intérieur d'une transaction Postgres
 * dont les deux premières instructions positionnent, via SET LOCAL (set_config),
 * les GUC lus par les policies RLS (app.current_user_id, app.current_household_id).
 * Le client de transaction est propagé aux services via AsyncLocalStorage — jamais
 * de connexion "nue" pour les tables protégées.
 */
@Injectable()
export class RlsContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exécute `fn` dans une transaction avec le contexte RLS positionné, et rend
   * le client de transaction disponible via `getClient()` pendant son exécution.
   */
  async run<T>(userId: string, householdId: string | null, fn: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId ?? ''}, true)`;
      return this.als.run({ tx, userId, householdId }, fn);
    });
  }

  /**
   * Réhausse le foyer actif *au sein de la transaction en cours* — utile quand un foyer
   * est créé ou rejoint : son id est connu côté client avant l'insertion (uuid généré
   * par Prisma), donc le contexte peut être positionné avant l'écriture plutôt qu'après,
   * évitant un cas d'œuf-et-poule avec la clause RETURNING (qui exige aussi une policy
   * SELECT satisfaite, cf. document 04 §S.2).
   */
  async setHouseholdContext(householdId: string): Promise<void> {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('Contexte RLS absent — impossible de fixer le foyer actif');
    await ctx.tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
    ctx.householdId = householdId;
  }

  /** Client de transaction courant — lève une erreur explicite si appelé hors contexte RLS. */
  getClient(): TxClient {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new Error(
        'RlsContextService.getClient() appelé hors contexte RLS — enveloppez cet appel dans RlsContextService.run(...)',
      );
    }
    return ctx.tx;
  }

  getUserId(): string {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('Contexte RLS absent — utilisateur inconnu');
    return ctx.userId;
  }

  getHouseholdId(): string | null {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('Contexte RLS absent — foyer inconnu');
    return ctx.householdId;
  }
}
