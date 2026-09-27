import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateSubaccountDto } from './dto/create-subaccount.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateSubaccountDto } from './dto/update-subaccount.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('accounts')
@UseGuards(HouseholdRequiredGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query('includeInactive') includeInactive: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.list(user.sub, user.householdId!, includeInactive === 'true');
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getOne(user.sub, user.householdId!, id);
  }

  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.create(user.sub, user.householdId!, dto);
  }

  @Post('subaccounts')
  createSubaccount(@Body() dto: CreateSubaccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.createSubaccount(user.sub, user.householdId!, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.update(user.sub, user.householdId!, id, dto);
  }

  @Patch('subaccounts/:id')
  updateSubaccount(@Param('id') id: string, @Body() dto: UpdateSubaccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.updateSubaccount(user.sub, user.householdId!, id, dto);
  }
}
