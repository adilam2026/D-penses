import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { RlsInterceptor } from './common/prisma/rls.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { HouseholdsModule } from './households/households.module';
import { CategoriesModule } from './categories/categories.module';
import { AccountsModule } from './accounts/accounts.module';
import { FinancialOperationsModule } from './financial-operations/financial-operations.module';
import { PlannedOperationsModule } from './planned-operations/planned-operations.module';
import { MedicalClaimsModule } from './medical-claims/medical-claims.module';
import { RecurrenceRulesModule } from './recurrence-rules/recurrence-rules.module';
import { PlanningModule } from './planning/planning.module';
import { FinancialPlansModule } from './financial-plans/financial-plans.module';
import { GoalsModule } from './goals/goals.module';
import { E2eModule } from './e2e/e2e.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    HouseholdsModule,
    CategoriesModule,
    AccountsModule,
    FinancialOperationsModule,
    PlannedOperationsModule,
    MedicalClaimsModule,
    RecurrenceRulesModule,
    PlanningModule,
    FinancialPlansModule,
    GoalsModule,
    E2eModule,
  ],
  controllers: [AppController],
  providers: [
    // Toute route est authentifiée par défaut ; @Public() lève l'exigence explicitement.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
  ],
})
export class AppModule {}
