import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOwnerPostDto {
  @IsNotEmpty()
  @IsInt()
  ownerId: number;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  kostId?: number;
}

export class UpdateOwnerPostDto {
  @IsNotEmpty()
  @IsInt()
  requesterId: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  kostId?: number | null;
}

export class CreatePostCommentDto {
  @IsNotEmpty()
  @IsString()
  content: string;
}
