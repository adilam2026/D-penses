import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolProjectionsService } from './school-projections.service';
import { GenerateSchoolProjectionsDto } from './dto/generate-school-projections.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller()
@UseGuards(HouseholdRequiredGuard)
export class SchoolProjectionsController {
  constructor(private readonly schoolProjections: SchoolProjectionsService) {}

  @Post('financial-plans/:id/school-projections')
  generate(@Param('id') id: string, @Body() dto: GenerateSchoolProjectionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.schoolProjections.generate(user.sub, user.householdId!, id, dto);
  }

  @Get('financial-plans/:id/school-projections')
  listForPlan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.schoolProjections.listForPlan(user.sub, user.householdId!, id);
  }

  /** §4 — candidates pour préremplir le wizard d'un nouveau plan réel. */
  @Get('school-projections/candidates')
  findCandidates(
    @Query('childId') childId: string,
    @Query('schoolYear') schoolYear: string,
    @Query('schoolName') schoolName: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.schoolProjections.findCandidates(user.sub, user.householdId!, childId, schoolYear, schoolName);
  }
}
