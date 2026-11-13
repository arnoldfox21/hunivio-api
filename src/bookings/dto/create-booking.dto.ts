import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBookingDto {
  @IsInt()
  kostId: number;

  @IsString()
  tenantName: string;

  @IsString()
  tenantPhone: string;

  @IsString()
  startDate: string;

  @IsInt()
  @Min(1)
  durationMonths: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
