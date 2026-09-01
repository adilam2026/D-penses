import { IsUUID } from 'class-validator';

export class LinkDeadlineDto {
  @IsUUID()
  deadlineId!: string;
}
