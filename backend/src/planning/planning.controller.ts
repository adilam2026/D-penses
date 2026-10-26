import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

@Controller('planning')
@UseGuards(HouseholdRequiredGuard)
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  /** `from` (optionnel, "AAAA-MM") : premier mois de la plage ; absent = mois courant. */
  @Get()
  get(@Query('months') months: string | undefined, @Query('from') from: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    if (from !== undefined && !MONTH_KEY.test(from)) {
      throw new BadRequestException('Le paramètre "from" doit être un mois au format AAAA-MM.');
    }
    return this.planning.getPlanning(user.sub, user.householdId!, months ? Number(months) : undefined, from);
  }
}
