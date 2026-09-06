import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CategorySubtypesService } from './category-subtypes.service';
import { UpdateCategorySubtypeDto } from './dto/update-category-subtype.dto';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { HouseholdRequiredGuard } from '../common/guards/household-required.guard';

@Controller('category-subtypes')
@UseGuards(HouseholdRequiredGuard)
export class CategorySubtypesController {
  constructor(private readonly categorySubtypes: CategorySubtypesService) {}

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategorySubtypeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categorySubtypes.update(user.sub, user.householdId!, id, dto);
  }
}
