import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IncomeService } from './income.service';
import { CreateIncomeSourceDto } from './dto/create-income-source.dto';
import { CreateIncomeOccurrenceDto } from './dto/create-income-occurrence.dto';
import { ConfirmIncomeOccurrenceDto } from './dto/confirm-income-occurrence.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('income-sources')
@UseGuards(HouseholdRequiredGuard)
export class IncomeSourcesController {
  constructor(private readonly income: IncomeService) {}

  @Post()
  create(@Body() dto: CreateIncomeSourceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.income.createSource(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.income.listSources(user.sub, user.householdId!);
  }

  @Post(':id/occurrences')
  createOccurrence(
    @Param('id') id: string,
    @Body() dto: CreateIncomeOccurrenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.income.createOccurrence(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/occurrences')
  listOccurrences(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.income.listOccurrences(user.sub, user.householdId!, id);
  }
}

// Contrôleur distinct (préfixe séparé) pour éviter tout conflit de route avec
// income-sources/:id — confirmer une occurrence est une action sur son propre id.
@Controller('income-occurrences')
@UseGuards(HouseholdRequiredGuard)
export class IncomeOccurrencesController {
  constructor(private readonly income: IncomeService) {}

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmIncomeOccurrenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.income.confirmOccurrence(user.sub, user.householdId!, id, dto);
  }
}
