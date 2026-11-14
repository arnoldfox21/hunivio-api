import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
} from 'class-validator';

export class UpdateKostDto {
  @IsOptional()
  @IsString()
  propertyCategory?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  pricePerMonth?: number;

  @IsOptional()
  @IsInt()
  pricePerDay?: number;

  @IsOptional()
  @IsInt()
  pricePerYear?: number;

  @IsOptional()
  @IsInt()
  depositAmount?: number;

  @IsOptional()
  @IsString()
  unitType?: string;

  @IsOptional()
  @IsString()
  furnishing?: string;

  @IsOptional()
  @IsInt()
  floorLevel?: number;

  @IsOptional()
  @IsInt()
  buildingArea?: number;

  @IsOptional()
  @IsInt()
  landArea?: number;

  @IsOptional()
  @IsInt()
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  bathrooms?: number;

  @IsOptional()
  @IsBoolean()
  hasCarport?: boolean;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsInt()
  originalPrice?: number;

  @IsOptional()
  @IsInt()
  discountPercent?: number;

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
  @IsInt()
  ownerId?: number;

  @IsOptional()
  @IsString()
  nearbyLandmark?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}
