import { Module } from '@nestjs/common';
import { PocketsController } from './pockets.controller';
import { PocketsService } from './pockets.service';

@Module({
  controllers: [PocketsController],
  providers: [PocketsService],
  exports: [PocketsService],
})
export class PocketsModule {}
