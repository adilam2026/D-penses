import { Module } from '@nestjs/common';
import { FinancialOperationsController } from './financial-operations.controller';
import { FinancialOperationsService } from './financial-operations.service';

@Module({
  controllers: [FinancialOperationsController],
  providers: [FinancialOperationsService],
  exports: [FinancialOperationsService],
})
export class FinancialOperationsModule {}
