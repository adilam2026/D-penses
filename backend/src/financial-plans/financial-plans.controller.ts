import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { FinancialPlansService } from './financial-plans.service';
import { CreateFinancialPlanDto } from './dto/create-financial-plan.dto';
import { UpdateFinancialPlanDto } from './dto/update-financial-plan.dto';
import { DuplicateFinancialPlanDto } from './dto/duplicate-financial-plan.dto';
import { AddBeneficiaryDto } from './dto/add-beneficiary.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('financial-plans')
@UseGuards(HouseholdRequiredGuard)
export class FinancialPlansController {
  constructor(private readonly financialPlans: FinancialPlansService) {}

  @Post()
  create(@Body() dto: CreateFinancialPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.findOne(user.sub, user.householdId!, id);
  }

  @Post(':id/beneficiaries')
  addBeneficiary(@Param('id') id: string, @Body() dto: AddBeneficiaryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.addBeneficiary(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/beneficiaries')
  listBeneficiaries(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.listBeneficiaries(user.sub, user.householdId!, id);
  }

  // R5 §2 — Modifier (identité/période, jamais le type structurel).
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinancialPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.update(user.sub, user.householdId!, id, dto);
  }

  // R5 §2 — Supprimer (bloqué si des paiements existent déjà sous ce plan, RG safe-delete).
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.remove(user.sub, user.householdId!, id);
  }

  // R5 §3 — Dupliquer avec sélection explicite des enfants bénéficiaires de la copie.
  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Body() dto: DuplicateFinancialPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.financialPlans.duplicate(user.sub, user.householdId!, id, dto);
  }
}
