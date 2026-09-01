import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { HouseholdsService } from './households.service';
import { AuthService } from '../auth/auth.service';
import { CreateHouseholdDto } from './dto/create-household.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { JoinHouseholdDto } from './dto/join-household.dto';
import { UpdateHouseholdSettingsDto } from './dto/update-household-settings.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('households')
export class HouseholdsController {
  constructor(
    private readonly households: HouseholdsService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(@Body() dto: CreateHouseholdDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const household = await this.households.create(user.sub, dto.name);
    const tokens = await this.auth.reissueForHousehold(user.sub, household.id, req.headers['user-agent']);
    return { household, ...tokens };
  }

  @Get('me')
  @UseGuards(HouseholdRequiredGuard)
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.households.getMine(user.sub, user.householdId!);
  }

  @Post('invites')
  @UseGuards(HouseholdRequiredGuard)
  createInvite(@Body() dto: CreateInviteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.households.createInvite(user.sub, user.householdId!, dto.role);
  }

  @Post('join')
  async join(@Body() dto: JoinHouseholdDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const household = await this.households.join(user.sub, user.householdId, dto.code);
    const tokens = await this.auth.reissueForHousehold(user.sub, household.id, req.headers['user-agent']);
    return { household, ...tokens };
  }

  @Patch('settings')
  @UseGuards(HouseholdRequiredGuard)
  updateSettings(@Body() dto: UpdateHouseholdSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.households.updateSettings(user.sub, user.householdId!, dto);
  }
}
