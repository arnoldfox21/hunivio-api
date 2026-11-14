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
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  bookingType?: string;

  @IsOptional()
  @IsString()
  surveyDateTime?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
