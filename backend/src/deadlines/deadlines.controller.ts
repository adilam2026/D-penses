import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DeadlinesService } from './deadlines.service';
import { UpdateDeadlineDto } from './dto/update-deadline.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('deadlines')
@UseGuards(HouseholdRequiredGuard)
export class DeadlinesController {
  constructor(private readonly deadlines: DeadlinesService) {}

  @Get()
  findAllOpen(@CurrentUser() user: AuthenticatedUser) {
    return this.deadlines.findAllOpen(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlines.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeadlineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlines.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlines.close(user.sub, user.householdId!, id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlines.cancel(user.sub, user.householdId!, id);
  }
}
