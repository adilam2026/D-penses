import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('children')
@UseGuards(HouseholdRequiredGuard)
export class ChildrenController {
  constructor(private readonly children: ChildrenService) {}

  @Post()
  create(@Body() dto: CreateChildDto, @CurrentUser() user: AuthenticatedUser) {
    return this.children.create(user.sub, user.householdId!, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.children.findAll(user.sub, user.householdId!);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.children.findOne(user.sub, user.householdId!, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChildDto, @CurrentUser() user: AuthenticatedUser) {
    return this.children.update(user.sub, user.householdId!, id, dto);
  }
}
