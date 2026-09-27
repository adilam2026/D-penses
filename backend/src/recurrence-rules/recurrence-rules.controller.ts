import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RecurrenceRulesService } from './recurrence-rules.service';
import { CreateRecurrenceRuleDto } from './dto/create-recurrence-rule.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('recurrence-rules')
@UseGuards(HouseholdRequiredGuard)
export class RecurrenceRulesController {
  constructor(private readonly recurrenceRules: RecurrenceRulesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.recurrenceRules.list(user.sub, user.householdId!);
  }

  @Post()
  create(@Body() dto: CreateRecurrenceRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurrenceRules.create(user.sub, user.householdId!, dto);
  }
}
