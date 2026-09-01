import { Module } from '@nestjs/common';
import { ChargePlansController } from './charge-plans.controller';
import { ChargePlansService } from './charge-plans.service';

@Module({
  controllers: [ChargePlansController],
  providers: [ChargePlansService],
})
export class ChargePlansModule {}
