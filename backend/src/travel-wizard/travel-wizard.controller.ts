import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { TravelWizardService } from './travel-wizard.service';
import { TravelWizardDto } from './dto/travel-wizard.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('travel-wizard')
@UseGuards(HouseholdRequiredGuard)
export class TravelWizardController {
  constructor(private readonly travelWizard: TravelWizardService) {}

  @Post()
  create(@Body() dto: TravelWizardDto, @CurrentUser() user: AuthenticatedUser) {
    return this.travelWizard.create(user.sub, user.householdId!, dto);
  }
}
