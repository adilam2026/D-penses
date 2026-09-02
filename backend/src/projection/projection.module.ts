import { Module } from '@nestjs/common';
import { ProjectionController } from './projection.controller';
import { ProjectionService } from './projection.service';

@Module({
  controllers: [ProjectionController],
  providers: [ProjectionService],
  exports: [ProjectionService],
})
export class ProjectionModule {}
