import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { VariableBudgetsModule } from '../variable-budgets/variable-budgets.module';

@Module({
  imports: [VariableBudgetsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
