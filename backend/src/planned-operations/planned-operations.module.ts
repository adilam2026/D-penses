import { Module } from '@nestjs/common';
import { PlannedOperationsController } from './planned-operations.controller';
import { PlannedOperationsService } from './planned-operations.service';

@Module({
  controllers: [PlannedOperationsController],
  providers: [PlannedOperationsService],
  exports: [PlannedOperationsService],
})
export class PlannedOperationsModule {}
