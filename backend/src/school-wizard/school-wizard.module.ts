import { Module } from '@nestjs/common';
import { SchoolWizardController } from './school-wizard.controller';
import { SchoolWizardService } from './school-wizard.service';

@Module({
  controllers: [SchoolWizardController],
  providers: [SchoolWizardService],
})
export class SchoolWizardModule {}
