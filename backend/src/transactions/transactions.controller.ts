import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('transactions')
@UseGuards(HouseholdRequiredGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  // Lot T1 — filtres serveur additifs sur le registre (§ analyse module
  // Transactions) : tous optionnels, combinés en AND côté service. `from`/`to`
  // en ISO 8601 datetime, convention [from, to) — jamais une date locale
  // implicite. `kind` = liste séparée par virgules (ex. "income,payment").
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('kind') kind?: string,
    @Query('accountId') accountId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('budgetId') budgetId?: string,
    @Query('financialPlanId') financialPlanId?: string,
    @Query('createdByUserId') createdByUserId?: string,
    // Correction UX (Transactions) — masque les écarts de rapprochement de
    // solde (jamais les corrections de dépenses, qui restent visibles) :
    // 'true'/'1' uniquement, absent = comportement historique inchangé.
    @Query('excludeReconciliation') excludeReconciliation?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.transactions.list(user.sub, user.householdId!, {
      limit: parsedLimit && parsedLimit > 0 ? parsedLimit : undefined,
      from,
      to,
      kind,
      accountId,
      categoryId,
      budgetId,
      financialPlanId,
      createdByUserId,
      excludeReconciliation: excludeReconciliation === 'true' || excludeReconciliation === '1',
    });
  }

  // §5 (recette téléphone réel) : détail d'une ligne de transaction — jamais un
  // second recalcul, une lecture enrichie de l'entité réelle derrière la ligne
  // LedgerEntry (kind+id identifient sans ambiguïté la ligne source, cf. la vue).
  @Get(':kind/:id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('kind') kind: string, @Param('id') id: string) {
    return this.transactions.detail(user.sub, user.householdId!, kind, id);
  }
}
