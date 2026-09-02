import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { RlsInterceptor } from './common/prisma/rls.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { HouseholdsModule } from './households/households.module';
import { ChildrenModule } from './children/children.module';
import { CategoriesModule } from './categories/categories.module';
import { AccountsModule } from './accounts/accounts.module';
import { IncomeModule } from './income/income.module';
import { ChargePlansModule } from './charge-plans/charge-plans.module';
import { DeadlinesModule } from './deadlines/deadlines.module';
import { PaymentsModule } from './payments/payments.module';
import { TransactionsModule } from './transactions/transactions.module';
import { VariableBudgetsModule } from './variable-budgets/variable-budgets.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FinancialPlansModule } from './financial-plans/financial-plans.module';
import { ActionsModule } from './actions/actions.module';
import { SchoolWizardModule } from './school-wizard/school-wizard.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CalendarModule } from './calendar/calendar.module';
import { PocketsModule } from './pockets/pockets.module';
import { ProvisionsModule } from './provisions/provisions.module';
import { GoalsModule } from './goals/goals.module';
import { ProjectionModule } from './projection/projection.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    HouseholdsModule,
    ChildrenModule,
    CategoriesModule,
    AccountsModule,
    IncomeModule,
    ChargePlansModule,
    DeadlinesModule,
    PaymentsModule,
    TransactionsModule,
    VariableBudgetsModule,
    ExpensesModule,
    FinancialPlansModule,
    ActionsModule,
    SchoolWizardModule,
    DashboardModule,
    CalendarModule,
    PocketsModule,
    ProvisionsModule,
    GoalsModule,
    ProjectionModule,
  ],
  controllers: [AppController],
  providers: [
    // Toute route est authentifiée par défaut ; @Public() lève l'exigence explicitement.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
  ],
})
export class AppModule {}
