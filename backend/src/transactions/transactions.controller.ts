import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('transactions')
@UseGuards(HouseholdRequiredGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : undefined;
    return this.transactions.list(user.sub, user.householdId!, parsed && parsed > 0 ? parsed : undefined);
  }

  // §5 (recette téléphone réel) : détail d'une ligne de transaction — jamais un
  // second recalcul, une lecture enrichie de l'entité réelle derrière la ligne
  // LedgerEntry (kind+id identifient sans ambiguïté la ligne source, cf. la vue).
  @Get(':kind/:id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('kind') kind: string, @Param('id') id: string) {
    return this.transactions.detail(user.sub, user.householdId!, kind, id);
  }
}
