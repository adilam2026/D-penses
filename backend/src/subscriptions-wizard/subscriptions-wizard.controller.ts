import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SubscriptionsWizardService } from './subscriptions-wizard.service';
import { SubscriptionsWizardDto } from './dto/subscriptions-wizard.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('subscriptions-wizard')
@UseGuards(HouseholdRequiredGuard)
export class SubscriptionsWizardController {
  constructor(private readonly subscriptionsWizard: SubscriptionsWizardService) {}

  @Post()
  create(@Body() dto: SubscriptionsWizardDto, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsWizard.create(user.sub, user.householdId!, dto);
  }
}
