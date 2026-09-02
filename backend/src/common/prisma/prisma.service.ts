import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Lot 9 (§24/§16 — audit formatage) : par défaut, decimal.js sérialise un
 * Decimal Prisma en JSON comme une CHAÎNE ("21300"), jamais un number. Un
 * champ Decimal renvoyé tel quel par un service (ex. Deadline.amountCurrent,
 * Goal.targetAmount, GoalContribution.plannedAmount) traversait donc l'API
 * comme string alors que chaque écran mobile le déclare `number` et appelle
 * `.toLocaleString()` dessus — un crash certain (String.prototype n'a pas
 * cette méthode), découvert en recette Lot 9 sur le scénario E (facture
 * confirmée) et I (Goal). Correctif unique et global au niveau de la
 * sérialisation JSON — aucune règle métier touchée, aucun service modifié :
 * chaque Decimal se sérialise désormais comme un number, exactement comme le
 * fait déjà toNumber()/round2() pour les valeurs déjà calculées à la main.
 */
(Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (this: Decimal) {
  return this.toNumber();
};

/**
 * Client Prisma racine. Ne jamais l'utiliser directement pour lire/écrire des
 * tables protégées par RLS (household, household_membership, child, category,
 * household_settings) sans être passé par RlsContextService — la connexion
 * porte le rôle applicatif dont les policies FORCE ROW LEVEL SECURITY.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connexion base de données établie');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
