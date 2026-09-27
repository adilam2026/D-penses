import { Module } from '@nestjs/common';
import { RecurrenceRulesController } from './recurrence-rules.controller';
import { RecurrenceRulesService } from './recurrence-rules.service';

@Module({
  controllers: [RecurrenceRulesController],
  providers: [RecurrenceRulesService],
  exports: [RecurrenceRulesService],
})
export class RecurrenceRulesModule {}
