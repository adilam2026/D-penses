import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlannedOperationsService } from './planned-operations.service';
import { CreatePlannedOperationDto } from './dto/create-planned-operation.dto';
import { RealizePlannedOperationDto } from './dto/realize-planned-operation.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('planned-operations')
@UseGuards(HouseholdRequiredGuard)
export class PlannedOperationsController {
  constructor(private readonly plannedOperations: PlannedOperationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.plannedOperations.list(user.sub, user.householdId!);
  }

  @Post()
  create(@Body() dto: CreatePlannedOperationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plannedOperations.create(user.sub, user.householdId!, dto);
  }

  @Post(':id/realize')
  realize(@Param('id') id: string, @Body() dto: RealizePlannedOperationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plannedOperations.realize(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plannedOperations.cancel(user.sub, user.householdId!, id);
  }
}
