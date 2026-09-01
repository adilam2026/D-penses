import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('dashboard')
@UseGuards(HouseholdRequiredGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser, @Query('at') at: string | undefined) {
    return this.dashboard.getSummary(user.sub, user.householdId!, at ? new Date(at) : new Date());
  }
}
