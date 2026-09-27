import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('categories')
@UseGuards(HouseholdRequiredGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.list(user.sub, user.householdId!);
  }

  @Post()
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.create(user.sub, user.householdId!, dto.name);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.update(user.sub, user.householdId!, id, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categories.archive(user.sub, user.householdId!, id);
  }
}
