import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('actions-a-traiter')
@UseGuards(HouseholdRequiredGuard)
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.actions.list(user.sub, user.householdId!);
  }
}
