import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseMetadataDto } from './dto/update-expense-metadata.dto';
import { CorrectExpenseDto } from './dto/correct-expense.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('expenses')
@UseGuards(HouseholdRequiredGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.create(user.sub, user.householdId!, dto);
  }

  // R5 clôture §1 — Modifier (description uniquement, jamais le montant).
  @Patch(':kind/:id')
  updateMetadata(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseMetadataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.updateMetadata(user.sub, user.householdId!, kind, id, dto);
  }

  // R5 clôture §1 — Corriger (contre-écriture Adjustment), adhoc_expense uniquement.
  @Post('adhoc_expense/:id/correct')
  correctAdhoc(@Param('id') id: string, @Body() dto: CorrectExpenseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.correctAdhoc(user.sub, user.householdId!, id, dto);
  }

  // R5 clôture §1 — Annuler (Adjustment intégral), adhoc_expense uniquement.
  @Post('adhoc_expense/:id/reverse')
  reverseAdhoc(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.reverseAdhoc(user.sub, user.householdId!, id);
  }
}
