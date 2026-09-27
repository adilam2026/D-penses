import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FinancialPlansService } from './financial-plans.service';
import { CreateFinancialPlanDto } from './dto/create-financial-plan.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('financial-plans')
@UseGuards(HouseholdRequiredGuard)
export class FinancialPlansController {
  constructor(private readonly financialPlans: FinancialPlansService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.list(user.sub, user.householdId!);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.getOne(user.sub, user.householdId!, id);
  }

  @Post()
  create(@Body() dto: CreateFinancialPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.create(user.sub, user.householdId!, dto);
  }
}
