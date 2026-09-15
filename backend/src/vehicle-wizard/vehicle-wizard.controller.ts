import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { VehicleWizardService } from './vehicle-wizard.service';
import { VehicleWizardDto } from './dto/vehicle-wizard.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('vehicle-wizard')
@UseGuards(HouseholdRequiredGuard)
export class VehicleWizardController {
  constructor(private readonly vehicleWizard: VehicleWizardService) {}

  @Post()
  create(@Body() dto: VehicleWizardDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vehicleWizard.create(user.sub, user.householdId!, dto);
  }
}
