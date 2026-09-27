import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MedicalClaimsService } from './medical-claims.service';
import { CreateReimbursementDto } from './dto/create-reimbursement.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('medical-claims')
@UseGuards(HouseholdRequiredGuard)
export class MedicalClaimsController {
  constructor(private readonly medicalClaims: MedicalClaimsService) {}

  @Get()
  list(@Query('subaccountId') subaccountId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.list(user.sub, user.householdId!, subaccountId);
  }

  @Post(':id/reimbursements')
  addReimbursement(@Param('id') id: string, @Body() dto: CreateReimbursementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.addReimbursement(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/close')
  closeManually(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.closeManually(user.sub, user.householdId!, id);
  }
}
