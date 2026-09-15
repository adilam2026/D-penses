import { Module } from '@nestjs/common';
import { SchoolProjectionsController } from './school-projections.controller';
import { SchoolProjectionsService } from './school-projections.service';

@Module({
  controllers: [SchoolProjectionsController],
  providers: [SchoolProjectionsService],
})
export class SchoolProjectionsModule {}
