import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TodoService } from './todo.service';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('todo')
@UseGuards(HouseholdRequiredGuard)
export class TodoController {
  constructor(private readonly todo: TodoService) {}

  /** monthsOffset omis = mois courant — c'est aussi l'appel utilisé pour le badge de la barre de navigation (§1, nombre total d'actions, tous responsables confondus). */
  @Get()
  get(@Query('monthsOffset') monthsOffset: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.todo.getTodo(user.sub, user.householdId!, monthsOffset ? Number(monthsOffset) : undefined);
  }
}
