import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsInt()
  @Min(1)
  kostId: number;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsString()
  @IsNotEmpty()
  tenantPhone: string;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  bookingType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  surveyDateTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  surveyTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateDirectBookingDto {
  @IsInt()
  @Min(1)
  kostId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  tenantName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  tenantPhone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  startDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  checkInTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  surveyDateTime?: string;

  @IsInt()
  @Min(1)
  @Max(30)
  durationCount: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  usePoints?: boolean;

  @IsOptional()
  @IsIn(['FULL', 'DP'])
  paymentScheme?: 'FULL' | 'DP';
}
