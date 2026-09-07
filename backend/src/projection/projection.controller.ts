import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ProjectionService } from './projection.service';
import { SimulateMonthlyDto } from './dto/simulate-monthly.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

/** "Tous" = paramètre absent ; une liste vide explicite `accountIds=` est distincte et n'inclut rien. */
function parseAccountIds(raw: string | undefined): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === '') return [];
  return raw.split(',').filter((s) => s.length > 0);
}

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

  /** GET /projection/monthly (Round 4 §2/§3/§4) — vue mensuelle consolidée, sans scénario. */
  @Get('monthly')
  getMonthly(
    @CurrentUser() user: AuthenticatedUser,
    @Query('at') at: string | undefined,
    @Query('horizonMonths') horizonMonths: string | undefined,
    @Query('incomeAccountIds') incomeAccountIds: string | undefined,
    @Query('expenseAccountIds') expenseAccountIds: string | undefined,
  ) {
    return this.projection.getMonthly(
      user.sub,
      user.householdId!,
      horizonMonths ? Number(horizonMonths) : undefined,
      at,
      parseAccountIds(incomeAccountIds),
      parseAccountIds(expenseAccountIds),
    );
  }

  /** POST /projection/monthly/simulate (§12/§13) — baseline + scénario, jamais de donnée réelle modifiée. */
  @Post('monthly/simulate')
  simulateMonthly(@CurrentUser() user: AuthenticatedUser, @Body() dto: SimulateMonthlyDto) {
    return this.projection.simulateMonthly(
      user.sub,
      user.householdId!,
      dto.horizonMonths,
      dto.at,
      dto.incomeAccountIds ?? undefined,
      dto.expenseAccountIds ?? undefined,
      dto.moves ?? [],
    );
  }
}
