import { Module } from '@nestjs/common';
import { VehicleWizardController } from './vehicle-wizard.controller';
import { VehicleWizardService } from './vehicle-wizard.service';

@Module({
  controllers: [VehicleWizardController],
  providers: [VehicleWizardService],
})
export class VehicleWizardModule {}
