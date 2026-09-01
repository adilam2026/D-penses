import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** RG-114 : type explicite + une seule des deux références renseignée selon le type. */
export class AddBeneficiaryDto {
  @IsIn(['user', 'child'])
  beneficiaryType!: 'user' | 'child';

  @ValidateIf((o) => o.beneficiaryType === 'user')
  @IsUUID()
  userId?: string;

  @ValidateIf((o) => o.beneficiaryType === 'child')
  @IsUUID()
  childId?: string;
}
