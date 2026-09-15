import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { HousingWizardService } from './housing-wizard.service';
import { HousingWizardDto } from './dto/housing-wizard.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('housing-wizard')
@UseGuards(HouseholdRequiredGuard)
export class HousingWizardController {
  constructor(private readonly housingWizard: HousingWizardService) {}

  @Post()
  create(@Body() dto: HousingWizardDto, @CurrentUser() user: AuthenticatedUser) {
    return this.housingWizard.create(user.sub, user.householdId!, dto);
  }
}
