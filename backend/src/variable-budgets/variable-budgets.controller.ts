import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { VariableBudgetsService } from './variable-budgets.service';
import { CreateVariableBudgetDto } from './dto/create-variable-budget.dto';
import { UpdateVariableBudgetDto } from './dto/update-variable-budget.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('variable-budgets')
@UseGuards(HouseholdRequiredGuard)
export class VariableBudgetsController {
  constructor(private readonly variableBudgets: VariableBudgetsService) {}

  // Route statique déclarée avant ':id' — même précaution que AccountsController.
  @Get('for-category/:categoryId')
  findActiveForCategory(
    @Param('categoryId') categoryId: string,
    @Query('at') at: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.variableBudgets.findActiveForCategory(user.sub, user.householdId!, categoryId, at);
  }

  @Post()
  create(@Body() dto: CreateVariableBudgetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.variableBudgets.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.variableBudgets.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.variableBudgets.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVariableBudgetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.variableBudgets.update(user.sub, user.householdId!, id, dto);
  }
}
