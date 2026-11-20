import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class GoogleAuthDto {
  @IsOptional()
  @IsString()
  googleId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  idToken?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  showWhatsapp?: boolean;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}

export class UpdateUserRoleDto {
  @IsNotEmpty()
  @IsString()
  role: string;

  @IsOptional()
  @IsInt()
  requesterId?: number;
}

export class CompleteOnboardingDto {
  @IsNotEmpty()
  @IsString()
  role: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @IsOptional()
  @IsString()
  preferredCategory?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  showWhatsapp?: boolean;
}

export class RegisterRoleDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['PENYEWA', 'PEMILIK_KOST'], {
    message: 'Peran yang dipilih harus Penyewa atau Pemilik Properti.',
  })
  role: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsBoolean()
  switchNow?: boolean;
}

export class SwitchRoleDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['PENYEWA', 'PEMILIK_KOST'], {
    message: 'Mode peran harus Penyewa atau Pemilik Properti.',
  })
  role: string;
}

export class EmailLoginDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}

export class SetPasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6, { message: 'Password minimal 6 karakter.' })
  newPassword: string;
}
