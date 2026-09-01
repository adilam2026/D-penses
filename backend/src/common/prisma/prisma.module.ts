import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RlsContextService } from './rls-context.service';

@Global()
@Module({
  providers: [PrismaService, RlsContextService],
  exports: [PrismaService, RlsContextService],
})
export class PrismaModule {}
