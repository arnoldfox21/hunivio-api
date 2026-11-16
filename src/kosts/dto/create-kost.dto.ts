import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  INDONESIAN_WA_MESSAGE,
  INDONESIAN_WA_REGEX,
  normalizeIndonesianPhoneInput,
} from '../../common/phone.util';

export class CreateKostDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  propertyCategory?: string;

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
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsInt()
  reviewCount?: number;

  @IsOptional()
  @IsInt()
  availableRooms?: number;

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
  @IsBoolean()
  allowDirectBooking?: boolean;

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
  @Transform(({ value }) => normalizeIndonesianPhoneInput(value))
  @IsString()
  @Matches(INDONESIAN_WA_REGEX, { message: INDONESIAN_WA_MESSAGE })
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
