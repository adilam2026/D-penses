import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ActionsModule } from '../actions/actions.module';
import { VariableBudgetsModule } from '../variable-budgets/variable-budgets.module';
import { FinancialPlansModule } from '../financial-plans/financial-plans.module';
import { ProjectionModule } from '../projection/projection.module';

@Module({
  imports: [ActionsModule, VariableBudgetsModule, FinancialPlansModule, ProjectionModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
