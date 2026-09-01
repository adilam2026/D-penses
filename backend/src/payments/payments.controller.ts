import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('deadlines/:deadlineId/payments')
@UseGuards(HouseholdRequiredGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  create(@Param('deadlineId') deadlineId: string, @Body() dto: CreatePaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.create(user.sub, user.householdId!, deadlineId, dto);
  }

  @Get()
  findAll(@Param('deadlineId') deadlineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.listByDeadline(user.sub, user.householdId!, deadlineId);
  }
}
