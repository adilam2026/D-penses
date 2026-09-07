import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CorrectPaymentDto } from './dto/correct-payment.dto';
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

  // R5 clôture §1 — contre-écriture (jamais une réécriture du Payment original).
  @Post(':paymentId/correct')
  correct(
    @Param('deadlineId') deadlineId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: CorrectPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.correct(user.sub, user.householdId!, deadlineId, paymentId, dto);
  }

  // R5 clôture §1 — annulation complète (remboursement), jamais un DELETE physique.
  @Post(':paymentId/reverse')
  reverse(@Param('deadlineId') deadlineId: string, @Param('paymentId') paymentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.reverse(user.sub, user.householdId!, deadlineId, paymentId);
  }
}
