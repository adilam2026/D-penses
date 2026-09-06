import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoryTypesController } from './category-types.controller';
import { CategoryTypesService } from './category-types.service';
import { CategorySubtypesController } from './category-subtypes.controller';
import { CategorySubtypesService } from './category-subtypes.service';

@Module({
  controllers: [CategoriesController, CategoryTypesController, CategorySubtypesController],
  providers: [CategoriesService, CategoryTypesService, CategorySubtypesService],
})
export class CategoriesModule {}
