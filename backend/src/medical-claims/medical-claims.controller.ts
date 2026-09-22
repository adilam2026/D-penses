import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MedicalClaimsService } from './medical-claims.service';
import { CloseMedicalClaimDto } from './dto/close-medical-claim.dto';
import { UpdateMedicalClaimDto } from './dto/update-medical-claim.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('medical-claims')
@UseGuards(HouseholdRequiredGuard)
export class MedicalClaimsController {
  constructor(private readonly medicalClaims: MedicalClaimsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMedicalClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseMedicalClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalClaims.close(user.sub, user.householdId!, id, dto);
  }
}
