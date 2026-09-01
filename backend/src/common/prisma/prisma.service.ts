import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
