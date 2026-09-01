import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CreateGoalContributionDto } from './dto/create-goal-contribution.dto';
import { ConfirmContributionDto } from './dto/confirm-contribution.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('goals')
@UseGuards(HouseholdRequiredGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Post()
  create(@Body() dto: CreateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/contributions')
  addContribution(@Param('id') id: string, @Body() dto: CreateGoalContributionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.addContribution(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/contributions')
  listContributions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.listContributions(user.sub, user.householdId!, id);
  }

  @Post('contributions/:contributionId/confirm')
  confirmContribution(@Param('contributionId') contributionId: string, @Body() dto: ConfirmContributionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.confirmContribution(user.sub, user.householdId!, contributionId, dto);
  }
}
