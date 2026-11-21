import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdatePlatformConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  freePropertyQuota?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  extraPropertySlotFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(25)
  bookingPlatformFeePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000000)
  minWithdrawAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000000)
  boost3dPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000000)
  boost7dPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000000)
  boost14dPrice?: number;

  @IsOptional()
  @IsBoolean()
  allowOwnerRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDirectBookingGlobal?: boolean;

  @IsOptional()
  @IsBoolean()
  allowWalletTopup?: boolean;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  maintenanceMessage?: string;

  @IsOptional()
  @ValidateIf((o) => Boolean(o.opsNotificationEmail && o.opsNotificationEmail.trim()))
  @IsEmail()
  @MaxLength(255)
  opsNotificationEmail?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxPendingPropertiesPerOwner?: number;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(120)
  chatRateLimitPerMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxActiveSurveysPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxDailySurveysPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxUnpaidBookingsPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxHourlyDirectBookingsPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPendingTopupsPerOwner?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  postRateLimitPerMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  commentRateLimitPerMin?: number;
}
