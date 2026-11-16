import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
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
  surveyDateTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDirectBookingDto {
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
}
