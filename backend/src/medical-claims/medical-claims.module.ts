import { Module } from '@nestjs/common';
import { MedicalClaimsService } from './medical-claims.service';
import { MedicalClaimsController } from './medical-claims.controller';

@Module({
  controllers: [MedicalClaimsController],
  providers: [MedicalClaimsService],
})
export class MedicalClaimsModule {}
