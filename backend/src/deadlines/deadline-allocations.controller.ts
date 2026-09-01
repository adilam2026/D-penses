import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DeadlineAllocationsService } from './deadline-allocations.service';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('deadlines/:deadlineId/allocations')
@UseGuards(HouseholdRequiredGuard)
export class DeadlineAllocationsController {
  constructor(private readonly allocations: DeadlineAllocationsService) {}

  @Post()
  create(@Param('deadlineId') deadlineId: string, @Body() dto: CreateAllocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.allocations.create(user.sub, user.householdId!, deadlineId, dto);
  }

  @Get()
  findAll(@Param('deadlineId') deadlineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.allocations.findAll(user.sub, user.householdId!, deadlineId);
  }
}
