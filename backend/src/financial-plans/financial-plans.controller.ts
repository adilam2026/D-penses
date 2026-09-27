import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { FinancialPlansService } from './financial-plans.service';
import { CreateFinancialPlanDto } from './dto/create-financial-plan.dto';
import { UpdateFinancialPlanDto } from './dto/update-financial-plan.dto';
import { CreatePlanItemDto } from './dto/create-plan-item.dto';
import { CreatePlanDeadlineDto } from './dto/create-plan-deadline.dto';
import { AddItemToDeadlineDto } from './dto/add-item-to-deadline.dto';
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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinancialPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: CreatePlanItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.addItem(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/deadlines')
  addDeadline(@Param('id') id: string, @Body() dto: CreatePlanDeadlineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.addDeadline(user.sub, user.householdId!, id, dto);
  }

  @Post('deadlines/:deadlineId/items')
  addItemToDeadline(@Param('deadlineId') deadlineId: string, @Body() dto: AddItemToDeadlineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.addItemToDeadline(user.sub, user.householdId!, deadlineId, dto);
  }

  @Post('deadlines/:deadlineId/mark-paid')
  markDeadlinePaid(@Param('deadlineId') deadlineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.markDeadlinePaid(user.sub, user.householdId!, deadlineId);
  }
}
