import { Module } from '@nestjs/common';
import { ProvisionsController } from './provisions.controller';
import { ProvisionsService } from './provisions.service';

@Module({
  controllers: [ProvisionsController],
  providers: [ProvisionsService],
  exports: [ProvisionsService],
})
export class ProvisionsModule {}
