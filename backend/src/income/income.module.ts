import { Module } from '@nestjs/common';
import { IncomeSourcesController, IncomeOccurrencesController } from './income.controller';
import { IncomeService } from './income.service';

@Module({
  controllers: [IncomeSourcesController, IncomeOccurrencesController],
  providers: [IncomeService],
})
export class IncomeModule {}
