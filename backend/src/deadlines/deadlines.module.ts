import { Module } from '@nestjs/common';
import { DeadlinesController } from './deadlines.controller';
import { DeadlinesService } from './deadlines.service';
import { DeadlineAllocationsController } from './deadline-allocations.controller';
import { DeadlineAllocationsService } from './deadline-allocations.service';

@Module({
  controllers: [DeadlinesController, DeadlineAllocationsController],
  providers: [DeadlinesService, DeadlineAllocationsService],
  exports: [DeadlinesService],
})
export class DeadlinesModule {}
