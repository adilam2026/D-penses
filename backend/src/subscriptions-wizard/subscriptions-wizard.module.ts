import { Module } from '@nestjs/common';
import { SubscriptionsWizardController } from './subscriptions-wizard.controller';
import { SubscriptionsWizardService } from './subscriptions-wizard.service';

@Module({
  controllers: [SubscriptionsWizardController],
  providers: [SubscriptionsWizardService],
})
export class SubscriptionsWizardModule {}
