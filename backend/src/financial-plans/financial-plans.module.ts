import { Module } from '@nestjs/common';
import { FinancialPlansController } from './financial-plans.controller';
import { FinancialPlansService } from './financial-plans.service';

@Module({
  controllers: [FinancialPlansController],
  providers: [FinancialPlansService],
})
export class FinancialPlansModule {}
