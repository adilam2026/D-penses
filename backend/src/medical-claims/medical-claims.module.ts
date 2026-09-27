import { Module } from '@nestjs/common';
import { MedicalClaimsController } from './medical-claims.controller';
import { MedicalClaimsService } from './medical-claims.service';

@Module({
  controllers: [MedicalClaimsController],
  providers: [MedicalClaimsService],
  exports: [MedicalClaimsService],
})
export class MedicalClaimsModule {}
