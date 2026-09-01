import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ProvisionsService } from './provisions.service';
import { CreateProvisionDto } from './dto/create-provision.dto';
import { UpdateProvisionDto } from './dto/update-provision.dto';
import { LinkDeadlineDto } from './dto/link-deadline.dto';
import { ContributeDto } from '../pockets/dto/contribute.dto';
import { WithdrawDto } from '../pockets/dto/withdraw.dto';
import { ConfirmMovementDto } from '../pockets/dto/confirm-movement.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('provisions')
@UseGuards(HouseholdRequiredGuard)
export class ProvisionsController {
  constructor(private readonly provisions: ProvisionsService) {}

  @Post()
  create(@Body() dto: CreateProvisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.provisions.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProvisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/contribute')
  contribute(@Param('id') id: string, @Body() dto: ContributeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.contribute(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Body() dto: WithdrawDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.withdraw(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/movements')
  listMovements(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.listMovements(user.sub, user.householdId!, id);
  }

  @Post('movements/:movementId/confirm')
  confirmMovement(@Param('movementId') movementId: string, @Body() dto: ConfirmMovementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.confirmMovement(user.sub, user.householdId!, movementId, dto);
  }

  @Get(':id/sufficiency')
  sufficiency(@Param('id') id: string, @Query('at') at: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.sufficiency(user.sub, user.householdId!, id, at);
  }

  @Post(':id/deadlines')
  linkDeadline(@Param('id') id: string, @Body() dto: LinkDeadlineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.linkDeadline(user.sub, user.householdId!, id, dto);
  }

  @Delete(':id/deadlines/:deadlineId')
  unlinkDeadline(@Param('id') id: string, @Param('deadlineId') deadlineId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.provisions.unlinkDeadline(user.sub, user.householdId!, id, deadlineId);
  }
}
