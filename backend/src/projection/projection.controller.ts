import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ProjectionService } from './projection.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('projection')
@UseGuards(HouseholdRequiredGuard)
export class ProjectionController {
  constructor(private readonly projection: ProjectionService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query('at') at: string | undefined,
    @Query('horizon') horizon: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return this.projection.get(user.sub, user.householdId!, at, horizon ? Number(horizon) : undefined, to);
  }
}
