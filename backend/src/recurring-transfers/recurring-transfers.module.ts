import { Module } from '@nestjs/common';
import { RecurringTransfersController } from './recurring-transfers.controller';
import { RecurringTransfersService } from './recurring-transfers.service';

@Module({
  controllers: [RecurringTransfersController],
  providers: [RecurringTransfersService],
})
export class RecurringTransfersModule {}
