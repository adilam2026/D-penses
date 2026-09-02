import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { SimulatePurchaseDto } from './dto/simulate-purchase.dto';
import { SimulateGoalContributionDto } from './dto/simulate-goal-contribution.dto';
import { SavingsCapacityDto } from './dto/savings-capacity.dto';
import { AnalyzeGoalDto } from './dto/analyze-goal.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('simulation')
@UseGuards(HouseholdRequiredGuard)
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Post('purchase')
  purchase(@Body() dto: SimulatePurchaseDto, @Query('at') at: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.simulation.purchase(user.sub, user.householdId!, at, dto);
  }

  @Post('goal-contribution')
  goalContribution(@Body() dto: SimulateGoalContributionDto, @Query('at') at: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.simulation.goalContribution(user.sub, user.householdId!, at, dto);
  }

  @Post('savings-capacity')
  savingsCapacity(@Body() dto: SavingsCapacityDto, @Query('at') at: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.simulation.savingsCapacity(user.sub, user.householdId!, at, dto);
  }

  @Post('goal')
  goal(@Body() dto: AnalyzeGoalDto, @Query('at') at: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.simulation.goal(user.sub, user.householdId!, at, dto);
  }
}
