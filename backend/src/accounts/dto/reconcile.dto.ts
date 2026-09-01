import { IsNumber } from 'class-validator';

export class ReconcileDto {
  @IsNumber()
  declaredBalance!: number;
}
