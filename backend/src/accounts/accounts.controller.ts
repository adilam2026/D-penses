import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { AdjustReconciliationDto } from './dto/adjust-reconciliation.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('accounts')
@UseGuards(HouseholdRequiredGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // Routes statiques déclarées avant ':id' — sinon Nest/Express matcherait
  // "summary"/"transfers" comme une valeur du paramètre :id.
  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getTreasurySummary(user.sub, user.householdId!);
  }

  @Get('quick-add-default')
  getQuickAddDefault(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getQuickAddDefaultAccount(user.sub, user.householdId!).then((accountId) => ({ accountId }));
  }

  @Post('transfers')
  createTransfer(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.createTransfer(user.sub, user.householdId!, dto);
  }

  @Get('transfers')
  listTransfers(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.listTransfers(user.sub, user.householdId!);
  }

  @Post('transfers/:id/confirm')
  confirmTransfer(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.confirmTransfer(user.sub, user.householdId!, id);
  }

  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.findOne(user.sub, user.householdId!, id);
  }

  @Post(':id/favorite')
  setFavorite(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.setFavorite(user.sub, user.householdId!, id);
  }

  @Post(':id/reconciliations')
  reconcile(@Param('id') id: string, @Body() dto: ReconcileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.reconcile(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/reconciliations')
  listReconciliations(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.listReconciliations(user.sub, user.householdId!, id);
  }

  @Post(':id/reconciliations/:reconciliationId/adjust')
  adjustReconciliation(
    @Param('id') id: string,
    @Param('reconciliationId') reconciliationId: string,
    @Body() dto: AdjustReconciliationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accounts.adjustReconciliation(user.sub, user.householdId!, id, reconciliationId, dto);
  }
}
