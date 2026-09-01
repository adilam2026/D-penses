import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ChargePlansService } from './charge-plans.service';
import { CreateChargePlanDto } from './dto/create-charge-plan.dto';
import { CreateDeadlineDto } from './dto/create-deadline.dto';
import { UpdateChargePlanDto } from './dto/update-charge-plan.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('charge-plans')
@UseGuards(HouseholdRequiredGuard)
export class ChargePlansController {
  constructor(private readonly chargePlans: ChargePlansService) {}

  @Post()
  create(@Body() dto: CreateChargePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.chargePlans.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.chargePlans.findAll(user.sub, user.householdId!);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChargePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.chargePlans.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/deadlines')
  createDeadline(@Param('id') id: string, @Body() dto: CreateDeadlineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.chargePlans.createDeadline(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/deadlines')
  listDeadlines(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chargePlans.listDeadlines(user.sub, user.householdId!, id);
  }
}
