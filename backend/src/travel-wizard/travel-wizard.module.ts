import { Module } from '@nestjs/common';
import { TravelWizardController } from './travel-wizard.controller';
import { TravelWizardService } from './travel-wizard.service';

@Module({
  controllers: [TravelWizardController],
  providers: [TravelWizardService],
})
export class TravelWizardModule {}
