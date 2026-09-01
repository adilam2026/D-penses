import { IsNumber, IsPositive, IsUUID } from 'class-validator';

/** Ventilation analytique optionnelle (RG-116) — purement informative, jamais un second Payment. */
export class CreateAllocationDto {
  @IsUUID()
  childId!: string;

  @IsNumber()
  @IsPositive()
  allocationAmount!: number;
}
