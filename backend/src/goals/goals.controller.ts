import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('goals')
@UseGuards(HouseholdRequiredGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.list(user.sub, user.householdId!);
  }

  @Post()
  create(@Body() dto: CreateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.create(user.sub, user.householdId!, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.remove(user.sub, user.householdId!, id);
  }
}
