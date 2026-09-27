import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FinancialOperationsService } from './financial-operations.service';
import { CreateFinancialOperationDto } from './dto/create-financial-operation.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('financial-operations')
@UseGuards(HouseholdRequiredGuard)
export class FinancialOperationsController {
  constructor(private readonly operations: FinancialOperationsService) {}

  @Get()
  list(@Query('accountId') accountId: string | undefined, @Query('subaccountId') subaccountId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.operations.list(user.sub, user.householdId!, { accountId, subaccountId });
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.operations.getOne(user.sub, user.householdId!, id);
  }

  @Post()
  create(@Body() dto: CreateFinancialOperationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.operations.create(user.sub, user.householdId!, dto);
  }
}
