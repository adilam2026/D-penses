import { Module } from '@nestjs/common';
import { VariableBudgetsController } from './variable-budgets.controller';
import { VariableBudgetsService } from './variable-budgets.service';

@Module({
  controllers: [VariableBudgetsController],
  providers: [VariableBudgetsService],
  exports: [VariableBudgetsService],
})
export class VariableBudgetsModule {}
