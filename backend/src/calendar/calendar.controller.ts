import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('calendar')
@UseGuards(HouseholdRequiredGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('at') at: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    const referenceDate = at ? new Date(at) : new Date();
    return this.calendar.listEvents(user.sub, user.householdId!, referenceDate, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }
}
