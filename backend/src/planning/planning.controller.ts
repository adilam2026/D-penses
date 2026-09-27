import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('planning')
@UseGuards(HouseholdRequiredGuard)
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  get(@Query('months') months: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.planning.getPlanning(user.sub, user.householdId!, months ? Number(months) : undefined);
  }
}
