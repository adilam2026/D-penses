import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { HousingService } from './housing.service';
import { CreateHousingDto } from './dto/create-housing.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('housing')
@UseGuards(HouseholdRequiredGuard)
export class HousingController {
  constructor(private readonly housing: HousingService) {}

  @Post()
  create(@Body() dto: CreateHousingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.housing.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.housing.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.housing.findOne(user.sub, user.householdId!, id);
  }
}
