import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateBookingDto {
  @IsInt()
  kostId: number;

  @IsString()
  tenantName: string;

  @IsString()
  tenantPhone: string;

  @IsString()
  startDate: string;

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
  notes?: string;
}
