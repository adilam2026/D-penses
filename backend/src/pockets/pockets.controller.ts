import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PocketsService } from './pockets.service';
import { CreateSavingsPocketDto } from './dto/create-savings-pocket.dto';
import { UpdateSavingsPocketDto } from './dto/update-savings-pocket.dto';
import { ContributeDto } from './dto/contribute.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { ConfirmMovementDto } from './dto/confirm-movement.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('pockets')
@UseGuards(HouseholdRequiredGuard)
export class PocketsController {
  constructor(private readonly pockets: PocketsService) {}

  @Post()
  create(@Body() dto: CreateSavingsPocketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.pockets.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSavingsPocketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.update(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/contribute')
  contribute(@Param('id') id: string, @Body() dto: ContributeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.contribute(user.sub, user.householdId!, id, dto);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Body() dto: WithdrawDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.withdraw(user.sub, user.householdId!, id, dto);
  }

  @Get(':id/movements')
  listMovements(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.listMovements(user.sub, user.householdId!, id);
  }

  @Post('movements/:movementId/confirm')
  confirmMovement(@Param('movementId') movementId: string, @Body() dto: ConfirmMovementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pockets.confirmMovement(user.sub, user.householdId!, movementId, dto);
  }
}
