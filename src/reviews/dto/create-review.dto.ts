import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  kostId: number;

  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsString()
  userAvatar?: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  ratingCleanliness: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  ratingSecurity: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  ratingAccuracy: number;

  @IsString()
  @IsNotEmpty()
  comment: string;
}
