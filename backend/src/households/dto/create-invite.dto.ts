import { IsIn, IsOptional } from 'class-validator';
import { HouseholdRole } from '@prisma/client';

export class CreateInviteDto {
  @IsOptional()
  @IsIn(['admin', 'member', 'read_only'])
  role?: HouseholdRole;
}
