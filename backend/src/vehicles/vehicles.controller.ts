import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('vehicles')
@UseGuards(HouseholdRequiredGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Post()
  create(@Body() dto: CreateVehicleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vehicles.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.vehicles.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vehicles.findOne(user.sub, user.householdId!, id);
  }
}
