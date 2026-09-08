import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RecurringTransfersService } from './recurring-transfers.service';
import { CreateRecurringTransferDto } from './dto/create-recurring-transfer.dto';
import { UpdateRecurringTransferDto } from './dto/update-recurring-transfer.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('recurring-transfers')
@UseGuards(HouseholdRequiredGuard)
export class RecurringTransfersController {
  constructor(private readonly recurringTransfers: RecurringTransfersService) {}

  @Post()
  create(@Body() dto: CreateRecurringTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringTransfers.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.recurringTransfers.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringTransfers.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRecurringTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringTransfers.update(user.sub, user.householdId!, id, dto);
  }
}
