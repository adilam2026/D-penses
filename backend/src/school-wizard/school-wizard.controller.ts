import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SchoolWizardService } from './school-wizard.service';
import { SchoolWizardDto } from './dto/school-wizard.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('school-wizard')
@UseGuards(HouseholdRequiredGuard)
export class SchoolWizardController {
  constructor(private readonly schoolWizard: SchoolWizardService) {}

  @Post()
  create(@Body() dto: SchoolWizardDto, @CurrentUser() user: AuthenticatedUser) {
    return this.schoolWizard.create(user.sub, user.householdId!, dto);
  }
}
