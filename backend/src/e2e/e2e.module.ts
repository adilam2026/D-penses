import { Module } from '@nestjs/common';
import { E2eController } from './e2e.controller';
import { E2eService } from './e2e.service';
import { HouseholdsModule } from '../households/households.module';

@Module({
  imports: [HouseholdsModule],
  controllers: [E2eController],
  providers: [E2eService],
})
export class E2eModule {}
