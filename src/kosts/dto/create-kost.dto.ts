import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
} from 'class-validator';

export class CreateKostDto {
  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsString()
  city: string;

  @IsString()
  district: string;

  @IsString()
  address: string;

  @IsString()
  description: string;

  @IsInt()
  pricePerMonth: number;

  @IsOptional()
  @IsInt()
  originalPrice?: number;

  @IsOptional()
  @IsInt()
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsInt()
  reviewCount?: number;

  @IsOptional()
  @IsInt()
  availableRooms?: number;

  @IsOptional()
  @IsInt()
  totalRooms?: number;

  @IsOptional()
  @IsString()
  roomSize?: string;

  @IsOptional()
  @IsBoolean()
  electricityIncluded?: boolean;

  @IsOptional()
  @IsBoolean()
  isSinggahsini?: boolean;

  @IsOptional()
  @IsBoolean()
  isInstantBooking?: boolean;

  @IsOptional()
  @IsArray()
  roomFacilities?: string[];

  @IsOptional()
  @IsArray()
  publicFacilities?: string[];

  @IsOptional()
  @IsArray()
  rules?: string[];

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsString()
  nearbyLandmark?: string;
}
