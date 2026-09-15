import { Module } from '@nestjs/common';
import { HousingWizardController } from './housing-wizard.controller';
import { HousingWizardService } from './housing-wizard.service';

@Module({
  controllers: [HousingWizardController],
  providers: [HousingWizardService],
})
export class HousingWizardModule {}
