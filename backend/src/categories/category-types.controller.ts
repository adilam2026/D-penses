import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CategoryTypesService } from './category-types.service';
import { CategorySubtypesService } from './category-subtypes.service';
import { CreateCategoryTypeDto } from './dto/create-category-type.dto';
import { UpdateCategoryTypeDto } from './dto/update-category-type.dto';
import { CreateCategorySubtypeDto } from './dto/create-category-subtype.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@UseGuards(HouseholdRequiredGuard)
@Controller()
export class CategoryTypesController {
  constructor(
    private readonly categoryTypes: CategoryTypesService,
    private readonly categorySubtypes: CategorySubtypesService,
  ) {}

  @Get('categories/:categoryId/types')
  findAllForCategory(@Param('categoryId') categoryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.categoryTypes.findAllForCategory(user.sub, user.householdId!, categoryId);
  }

  @Post('categories/:categoryId/types')
  create(@Param('categoryId') categoryId: string, @Body() dto: CreateCategoryTypeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categoryTypes.create(user.sub, user.householdId!, categoryId, dto);
  }

  @Patch('category-types/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryTypeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categoryTypes.update(user.sub, user.householdId!, id, dto);
  }

  @Post('category-types/:categoryTypeId/subtypes')
  createSubtype(
    @Param('categoryTypeId') categoryTypeId: string,
    @Body() dto: CreateCategorySubtypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categorySubtypes.create(user.sub, user.householdId!, categoryTypeId, dto);
  }
}
