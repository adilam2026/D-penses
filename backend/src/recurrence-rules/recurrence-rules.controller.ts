import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RecurrenceRulesService } from './recurrence-rules.service';
import { CreateRecurrenceRuleDto } from './dto/create-recurrence-rule.dto';
import { UpdateRecurrenceRuleDto } from './dto/update-recurrence-rule.dto';
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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRecurrenceRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurrenceRules.update(user.sub, user.householdId!, id, dto);
  }
}
