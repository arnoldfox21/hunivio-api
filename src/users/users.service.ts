import * as crypto from 'crypto';
import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { KostReport } from '../kosts/entities/kost-report.entity';
import { UserFavorite } from '../kosts/entities/user-favorite.entity';
import { Article } from '../articles/entities/article.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PointTransaction } from '../bookings/entities/point-transaction.entity';
import { ChatMessage } from '../chats/entities/chat-message.entity';
import { KostGroupMessage } from '../chats/entities/kost-group-message.entity';
import { KostGroupSetting } from '../chats/entities/kost-group-setting.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { OwnerPost } from '../posts/entities/owner-post.entity';
import { OwnerPostComment } from '../posts/entities/owner-post-comment.entity';
import { OwnerPostLike } from '../posts/entities/owner-post-like.entity';
import { Review } from '../reviews/entities/review.entity';
import { ReviewReport } from '../reviews/entities/review-report.entity';
import { PayoutRequest } from '../wallet/entities/payout-request.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';
import {
  GoogleAuthDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  CompleteOnboardingDto,
  EmailLoginDto,
  SetPasswordDto,
  RegisterRoleDto,
} from './dto/google-auth.dto';
import { signAuthToken } from '../auth/jwt.util';
import {
  normalizeCityNameOrThrow,
  normalizeIndonesianPhoneOrThrow,
  normalizeUsernameOrThrow,
} from '../common/validation.util';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { PlatformService } from '../platform/platform.service';

export function getGoogleOAuthConfig() {
  return {
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      '946056205847-4rh8tk8j7oha26gh9fs80olh43juh77m.apps.googleusercontent.com',
    projectId: 'celestial-gecko-465811-m4',
    authUri: 'https://accounts.google.com/o/oauth2/auth',
    tokenUri: 'https://oauth2.googleapis.com/token',
    authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
  };
}

export const GOOGLE_OAUTH_CONFIG = getGoogleOAuthConfig();

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
    private readonly storageService: StorageService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly platformService?: PlatformService,
  ) {}

  async onModuleInit() {
    await this.userRepository.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "roles" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await this.userRepository.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "fcmTokens" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await this.userRepository.query(
      `UPDATE users SET "fcmTokens" = jsonb_build_array("fcmToken") WHERE COALESCE("fcmToken", '') <> '' AND "fcmTokens" = '[]'::jsonb`,
    );
    if (process.env.ENABLE_AUTO_SEED === 'true') {
      await this._ensureDefaultStaffPartner();
    }
  }

  private async _ensureDefaultStaffPartner() {
    const email = 'partner.malang@keyloka.id';
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) return;
    const partner = this.userRepository.create({
      googleId: 'staff_partner_malang',
      email,
      name: 'Keyloka Partner Malang',
      username: 'keylokapartnermalang',
      avatarUrl:
        'https://ui-avatars.com/api/?name=Keyloka+Partner+Malang&background=1BAA56&color=ffffff&size=256&bold=true&format=png',
      phone: '6281234567890',
      showWhatsapp: true,
      bio: 'Pengelola & kurator properti resmi Keyloka area Malang Raya. Siap membantu jadwal survei dan info ketersediaan unit.',
      city: 'Kota Malang',
      role: 'STAFF',
      onboardingCompleted: true,
      passwordHash: this._hashPassword('Keyloka2026!'),
    });
    await this.userRepository.save(partner);
  }

  private _getEffectiveRoles(user: User): string[] {
    const activeRole = (user.role || 'PENYEWA').trim().toUpperCase();
    if (
      activeRole === 'STAFF' ||
      activeRole === 'ADMINISTRATOR' ||
      activeRole === 'PENULIS'
    ) {
      return [activeRole];
    }

    const rawRoles = Array.isArray(user.roles) ? user.roles : [];
    const set = new Set<string>();
    for (const r of rawRoles) {
      const upper = String(r || '').trim().toUpperCase();
      if (upper === 'PENYEWA' || upper === 'PEMILIK_KOST') {
        set.add(upper);
      }
    }
    if (activeRole === 'PENYEWA' || activeRole === 'PEMILIK_KOST') {
      set.add(activeRole);
    }
    if (set.size === 0) {
      set.add('PENYEWA');
    }
    const ordered: string[] = [];
    if (set.has('PENYEWA')) ordered.push('PENYEWA');
    if (set.has('PEMILIK_KOST')) ordered.push('PEMILIK_KOST');
    return ordered;
  }

  sanitizeUser(user: User, includePrivate = false) {
    const upperRole = (user.role || '').toUpperCase();
    const isStaffOrAdmin = upperRole === 'STAFF' || upperRole === 'ADMINISTRATOR';
    const base = {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      username: user.username,
      bio: user.bio,
      city: user.city,
      coverUrl: user.coverUrl,
      role: user.role,
      roles: this._getEffectiveRoles(user),
      isVerified: !isStaffOrAdmin && Boolean(user.isVerified),
      verificationStatus: isStaffOrAdmin
        ? 'NONE'
        : user.verificationStatus || (user.isVerified ? 'VERIFIED' : 'NONE'),
      showWhatsapp: Boolean(user.showWhatsapp),
      isBanned: Boolean(user.isBanned),
      bannedAt: user.bannedAt ?? null,
      onboardingCompleted: user.onboardingCompleted ?? true,
      preferredCategory: user.preferredCategory ?? '',
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    if (!includePrivate) {
      if (user.showWhatsapp && user.phone && user.phone.trim().length > 0) {
        return {
          ...base,
          phone: user.phone,
        };
      }
      return base;
    }
    return {
      ...base,
      email: user.email,
      phone: user.phone,
      verificationSurveyDate: user.verificationSurveyDate || '',
      verificationKostId: user.verificationKostId ?? null,
      verificationNotes: user.verificationNotes || '',
      verificationRejectionReason: user.verificationRejectionReason || '',
      hasPassword: Boolean(user.passwordHash),
      creditBalance: Number(user.creditBalance ?? 0),
      payoutBalance: Number(user.payoutBalance ?? 0),
      pointsBalance: Number(user.pointsBalance ?? 0),
      totalPointsEarned: Number(user.totalPointsEarned ?? 0),
      loyaltyLevel: this._computeLoyaltyLevel(Number(user.totalPointsEarned ?? 0)),
    };
  }

  private _computeLoyaltyLevel(totalPoints: number): string {
    if (totalPoints >= 700) return 'Platinum';
    if (totalPoints >= 300) return 'Gold';
    if (totalPoints >= 100) return 'Silver';
    return 'Bronze';
  }

  private _hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
  }

  private _verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, keyHex] = parts;
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  }

  async loginWithEmail(dto: EmailLoginDto): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    accessToken: string;
    isNewUser: boolean;
  }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Email atau password salah.');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Akun ini belum mengatur password. Silakan masuk dengan Google lalu atur password di menu Keamanan Akun.',
      );
    }
    if (!this._verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Email atau password salah.');
    }
    if (user.isBanned) {
      throw new ForbiddenException(
        'Akun Anda sedang ditangguhkan oleh administrator.',
      );
    }
    user.lastLoginAt = new Date();
    const saved = await this.userRepository.save(user);
    const accessToken = signAuthToken({
      userId: saved.id,
      role: saved.role,
      email: saved.email,
    });
    return {
      user: this.sanitizeUser(saved, true),
      accessToken,
      isNewUser: false,
    };
  }

  async setOrChangePassword(
    userId: number,
    dto: SetPasswordDto,
  ): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    message: string;
  }> {
    const user = await this.findOne(userId);
    const hadPassword = Boolean(user.passwordHash);
    if (hadPassword) {
      if (
        !dto.currentPassword ||
        !this._verifyPassword(dto.currentPassword, user.passwordHash!)
      ) {
        throw new UnauthorizedException('Password saat ini tidak sesuai.');
      }
    }
    user.passwordHash = this._hashPassword(dto.newPassword);
    const saved = await this.userRepository.save(user);
    return {
      user: this.sanitizeUser(saved, true),
      message: hadPassword
        ? 'Password berhasil diperbarui.'
        : 'Password berhasil diatur. Anda kini dapat login dengan email.',
    };
  }

  async loginOrRegisterWithGoogle(dto: GoogleAuthDto): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    accessToken: string;
    isNewUser: boolean;
  }> {
    let googleId: string | undefined;
    let email: string | undefined;
    let name = dto.name?.trim();
    let avatarUrl = dto.avatarUrl?.trim();
    let verifiedWithGoogle = false;

    if (dto.accessToken) {
      try {
        const res = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${dto.accessToken}` },
            signal: AbortSignal.timeout(4000),
          },
        );
        if (res.ok) {
          const info = (await res.json()) as {
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
          };
          if (info.sub && info.email) {
            googleId = info.sub;
            email = info.email.toLowerCase();
            if (info.name) name = info.name;
            if (info.picture) avatarUrl = info.picture;
            verifiedWithGoogle = true;
          }
        }
      } catch (_) {}
    }

    if (!verifiedWithGoogle && dto.idToken) {
      try {
        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (res.ok) {
          const info = (await res.json()) as {
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
          };
          if (info.sub && info.email) {
            googleId = info.sub;
            email = info.email.toLowerCase();
            if (info.name) name = info.name;
            if (info.picture) avatarUrl = info.picture;
            verifiedWithGoogle = true;
          }
        }
      } catch (_) {}
    }

    if (!verifiedWithGoogle || !email || !googleId) {
      throw new UnauthorizedException(
        'Verifikasi akun Google gagal. Pastikan token Google valid.',
      );
    }

    const displayName = name && name.length > 0 ? name : email.split('@')[0];
    const fallbackAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1BAA56&color=ffffff&size=256&bold=true&format=png`;
    const resolvedAvatarUrl =
      avatarUrl && avatarUrl.length > 0 ? avatarUrl : fallbackAvatarUrl;

    let user = await this.userRepository.findOne({
      where: [{ googleId }, { email }],
    });

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = this.userRepository.create({
        googleId,
        email,
        name: displayName,
        avatarUrl: resolvedAvatarUrl,
        role: 'PENYEWA',
        roles: ['PENYEWA'],
        onboardingCompleted: false,
        lastLoginAt: new Date(),
      });
    } else {
      if (user.isBanned) {
        throw new ForbiddenException(
          'Akun Anda telah dibanned dan tidak dapat masuk ke aplikasi.',
        );
      }
      user.googleId = googleId;
      user.email = email;
      if (!user.name || user.name.trim().length === 0) {
        user.name = displayName;
      }
      // Simpan foto profil jika sebelumnya masih kosong / placeholder, atau perbarui jika mendapat foto asli Google
      const hasCustomAvatar =
        user.avatarUrl &&
        user.avatarUrl.trim().length > 0 &&
        !user.avatarUrl.includes('ui-avatars.com');
      if (!hasCustomAvatar && resolvedAvatarUrl) {
        user.avatarUrl = resolvedAvatarUrl;
      } else if (
        avatarUrl &&
        avatarUrl.includes('googleusercontent.com') &&
        (!user.avatarUrl || user.avatarUrl.includes('googleusercontent.com'))
      ) {
        user.avatarUrl = avatarUrl;
      }
      user.lastLoginAt = new Date();
    }

    const saved = await this.userRepository.save(user);
    if (isNewUser && saved.email) {
      void this.mailService?.sendEmail(saved.email, {
        subject: `Selamat Datang di Keyloka, ${saved.name}!`,
        preheader:
          'Akun Keyloka Anda berhasil dibuat. Lengkapi profil dan mulai cari atau kelola hunian dengan aman.',
        badgeText: 'Selamat Datang',
        badgeTone: 'emerald',
        title: 'Selamat Datang di Keyloka!',
        greetingName: saved.name,
        intro:
          'Terima kasih telah bergabung dengan Keyloka — platform pencarian kost, kontrakan, apartemen, dan hunian harian yang aman dengan perlindungan Escrow.',
        details: [
          { label: 'Email Terdaftar', value: saved.email },
          { label: 'Metode Masuk', value: 'Google Sign-In' },
          {
            label: 'Langkah Berikutnya',
            value: 'Lengkapi profil & pilih peran (Penyewa / Pemilik Properti)',
          },
        ],
        ctaLabel: 'Lengkapi Profil & Mulai',
        ctaUrl: '/onboarding',
        outroNote:
          'Sebagai Pemilik Properti, Anda dapat langsung mengaktifkan mode pemilik dan memasang iklan hunian pertama Anda secara gratis (kuota awal 2 properti).',
      });
    }
    const accessToken = signAuthToken({
      userId: saved.id,
      role: saved.role,
      email: saved.email,
    });
    return {
      user: this.sanitizeUser(saved, true),
      accessToken,
      isNewUser,
    };
  }

  async findAll(query?: {
    search?: string;
    role?: string;
    page?: number;
    limit?: number;
  }): Promise<User[]> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .orderBy('user.id', 'ASC');

    if (query?.role && query.role.trim() !== '' && query.role !== 'SEMUA') {
      const filterRole = query.role.trim().toUpperCase();
      if (filterRole === 'PENYEWA' || filterRole === 'PEMILIK_KOST') {
        qb.andWhere('(UPPER(user.role) = :role OR user.roles @> :roleJson)', {
          role: filterRole,
          roleJson: JSON.stringify([filterRole]),
        });
      } else {
        qb.andWhere('UPPER(user.role) = :role', {
          role: filterRole,
        });
      }
    }

    if (query?.search && query.search.trim() !== '') {
      const s = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(user.name) LIKE :s OR LOWER(user.email) LIKE :s OR LOWER(user.phone) LIKE :s)',
        { s },
      );
    }

    const limit = Math.min(50, Math.max(1, query?.limit || 20));
    const page = Math.max(1, query?.page || 1);
    qb.skip((page - 1) * limit).take(limit);

    return qb.getMany();
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User dengan ID ${id} tidak ditemukan`);
    }
    return user;
  }

  async updateProfile(
    id: number,
    dto: UpdateUserDto,
    requesterId?: number,
    requesterRole?: string,
  ): Promise<User> {
    const user = await this.findOne(id);
    const reqRole = (requesterRole || '').toUpperCase();
    const targetRole = (user.role || '').toUpperCase();
    if (
      requesterId &&
      requesterId !== id &&
      reqRole === 'STAFF' &&
      (targetRole === 'STAFF' || targetRole === 'ADMINISTRATOR')
    ) {
      throw new ForbiddenException(
        'Staff hanya dapat mengelola akun Penyewa atau Pemilik Kost.',
      );
    }
    if (dto.name !== undefined && dto.name.trim().length > 0) {
      user.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      const trimmedPhone = dto.phone.trim();
      user.phone = trimmedPhone
        ? normalizeIndonesianPhoneOrThrow(trimmedPhone)
        : '';
    }
    if (dto.showWhatsapp !== undefined) {
      user.showWhatsapp = Boolean(dto.showWhatsapp);
    }
    if (dto.role !== undefined && dto.role.trim().length > 0) {
      const requestedRole = dto.role.trim().toUpperCase();
      if (requestedRole !== (user.role || '').toUpperCase()) {
        throw new ForbiddenException(
          'Peran pengguna tidak dapat diubah sendiri. Hubungi Staff/Admin.',
        );
      }
    }
    if (dto.username !== undefined) {
      user.username = normalizeUsernameOrThrow(dto.username);
    }
    if (dto.bio !== undefined) {
      user.bio = dto.bio.trim();
    }
    if (dto.city !== undefined) {
      const trimmedCity = dto.city.trim();
      user.city = trimmedCity ? normalizeCityNameOrThrow(trimmedCity) : '';
    }
    const previousAvatar = user.avatarUrl;
    const previousCover = user.coverUrl;
    if (dto.avatarUrl !== undefined && dto.avatarUrl.trim().length > 0) {
      user.avatarUrl = dto.avatarUrl.trim();
    }
    if (dto.coverUrl !== undefined) {
      user.coverUrl = dto.coverUrl.trim();
    }
    if (dto.fcmToken !== undefined) {
      await this._applyFcmTokenUpdate(user, dto.fcmToken);
    }
    const saved = await this.userRepository.save(user);
    if (previousAvatar && previousAvatar !== saved.avatarUrl) {
      void this.storageService.deleteByUrl(previousAvatar);
    }
    if (previousCover && previousCover !== saved.coverUrl) {
      void this.storageService.deleteByUrl(previousCover);
    }
    return saved;
  }

  async updateUserRole(id: number, dto: UpdateUserRoleDto): Promise<User> {
    const requester = await this.userRepository.findOne({
      where: { id: dto.requesterId },
    });
    const requesterRole = (requester?.role || '').toUpperCase();
    if (!requester || requesterRole !== 'ADMINISTRATOR') {
      throw new ForbiddenException(
        'Hanya Administrator yang dapat mengubah peran pengguna.',
      );
    }

    if (id === 1) {
      throw new ForbiddenException(
        'Peran Administrator utama tidak dapat diubah.',
      );
    }

    const user = await this.findOne(id);
    const normalizedRole = dto.role.trim().toUpperCase();
    const allowedRoles = [
      'PENYEWA',
      'PEMILIK_KOST',
      'PENULIS',
      'STAFF',
      'ADMINISTRATOR',
    ];
    if (!allowedRoles.includes(normalizedRole)) {
      throw new BadRequestException('Peran pengguna tidak valid.');
    }

    user.role = normalizedRole;
    if (normalizedRole === 'PENYEWA' || normalizedRole === 'PEMILIK_KOST') {
      const existing = Array.isArray(user.roles) ? user.roles : [];
      const nextSet = new Set(
        existing
          .map((r) => String(r || '').trim().toUpperCase())
          .filter((r) => r === 'PENYEWA' || r === 'PEMILIK_KOST'),
      );
      nextSet.add(normalizedRole);
      user.roles = Array.from(nextSet);
    } else {
      user.roles = [normalizedRole];
    }
    const saved = await this.userRepository.save(user);
    void this.platformService?.recordEvent({
      level: 'INFO',
      category: 'CONFIG',
      actorUserId: dto.requesterId ?? null,
      message: `Role pengguna userId=${id} diubah menjadi ${normalizedRole}`,
      meta: { targetUserId: id, nextRole: normalizedRole },
    });
    return saved;
  }

  async completeOnboarding(
    userId: number,
    dto: CompleteOnboardingDto,
  ): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    accessToken: string;
  }> {
    const user = await this.findOne(userId);
    if (user.onboardingCompleted) {
      throw new ForbiddenException(
        'Onboarding sudah selesai. Peran tidak dapat diubah lagi melalui langkah ini.',
      );
    }

    const normalizedRole = dto.role.trim().toUpperCase();
    const requestedRoles = Array.isArray(dto.roles)
      ? dto.roles
          .map((r) => String(r || '').trim().toUpperCase())
          .filter((r) => r === 'PENYEWA' || r === 'PEMILIK_KOST')
      : [];

    let finalRoles: string[] = [];
    let activeRole = 'PENYEWA';
    if (
      normalizedRole === 'BOTH' ||
      (requestedRoles.includes('PENYEWA') &&
        requestedRoles.includes('PEMILIK_KOST'))
    ) {
      finalRoles = ['PENYEWA', 'PEMILIK_KOST'];
      activeRole = 'PENYEWA';
    } else if (normalizedRole === 'PENYEWA' || normalizedRole === 'PEMILIK_KOST') {
      finalRoles = [normalizedRole];
      activeRole = normalizedRole;
    } else {
      throw new BadRequestException(
        'Pilih peran sebagai Penyewa, Pemilik Properti, atau Keduanya.',
      );
    }

    if (finalRoles.includes('PEMILIK_KOST')) {
      const cfg = await this.platformService?.getSettings().catch(() => null);
      if (cfg && cfg.allowOwnerRegistration === false) {
        throw new ForbiddenException(
          'Pendaftaran sebagai pemilik properti sedang ditutup sementara oleh administrator.',
        );
      }
    }

    user.role = activeRole;
    user.roles = finalRoles;
    if (dto.preferredCategory !== undefined) {
      user.preferredCategory = dto.preferredCategory.trim();
    }
    if (dto.city !== undefined && dto.city.trim().length > 0) {
      user.city = normalizeCityNameOrThrow(dto.city);
    }
    if (dto.phone !== undefined && dto.phone.trim().length > 0) {
      user.phone = normalizeIndonesianPhoneOrThrow(dto.phone);
    }
    user.onboardingCompleted = true;

    const saved = await this.userRepository.save(user);
    const accessToken = signAuthToken({
      userId: saved.id,
      role: saved.role,
      email: saved.email,
    });

    return {
      user: this.sanitizeUser(saved, true),
      accessToken,
    };
  }

  async registerAdditionalRole(
    userId: number,
    dto: RegisterRoleDto,
  ): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    accessToken: string;
  }> {
    const user = await this.findOne(userId);
    const currentRole = (user.role || 'PENYEWA').trim().toUpperCase();
    if (
      currentRole === 'STAFF' ||
      currentRole === 'ADMINISTRATOR' ||
      currentRole === 'PENULIS'
    ) {
      throw new ForbiddenException(
        'Akun internal atau penulis tidak dapat mendaftar peran tambahan secara mandiri.',
      );
    }

    const targetRole = dto.role.trim().toUpperCase();
    if (targetRole !== 'PENYEWA' && targetRole !== 'PEMILIK_KOST') {
      throw new BadRequestException(
        'Peran tambahan harus Penyewa atau Pemilik Properti.',
      );
    }
    if (targetRole === 'PEMILIK_KOST') {
      const cfg = await this.platformService?.getSettings().catch(() => null);
      if (cfg && cfg.allowOwnerRegistration === false) {
        throw new ForbiddenException(
          'Pendaftaran sebagai pemilik properti sedang ditutup sementara oleh administrator.',
        );
      }
    }

    const rawPhone =
      dto.phone !== undefined && dto.phone.trim().length > 0
        ? dto.phone.trim()
        : (user.phone || '').trim();
    const rawCity =
      dto.city !== undefined && dto.city.trim().length > 0
        ? dto.city.trim()
        : (user.city || '').trim();

    let nextPhone = rawPhone;
    let nextCity = rawCity;
    if (targetRole === 'PEMILIK_KOST') {
      nextPhone = normalizeIndonesianPhoneOrThrow(rawPhone);
      nextCity = normalizeCityNameOrThrow(rawCity);
    } else {
      if (rawPhone) nextPhone = normalizeIndonesianPhoneOrThrow(rawPhone);
      if (rawCity) nextCity = normalizeCityNameOrThrow(rawCity);
    }

    if (nextPhone) user.phone = nextPhone;
    if (nextCity) user.city = nextCity;

    const roleSet = new Set(this._getEffectiveRoles(user));
    roleSet.add(targetRole);
    const ordered: string[] = [];
    if (roleSet.has('PENYEWA')) ordered.push('PENYEWA');
    if (roleSet.has('PEMILIK_KOST')) ordered.push('PEMILIK_KOST');
    user.roles = ordered;

    if (dto.switchNow !== false) {
      user.role = targetRole;
    }
    user.onboardingCompleted = true;

    const saved = await this.userRepository.save(user);
    const accessToken = signAuthToken({
      userId: saved.id,
      role: saved.role,
      email: saved.email,
    });

    return {
      user: this.sanitizeUser(saved, true),
      accessToken,
    };
  }

  async switchActiveRole(
    userId: number,
    rawRole: string,
  ): Promise<{
    user: ReturnType<UsersService['sanitizeUser']>;
    accessToken: string;
  }> {
    const user = await this.findOne(userId);
    const currentRole = (user.role || 'PENYEWA').trim().toUpperCase();
    if (
      currentRole === 'STAFF' ||
      currentRole === 'ADMINISTRATOR' ||
      currentRole === 'PENULIS'
    ) {
      throw new ForbiddenException(
        'Akun ini tidak mendukung perpindahan mode Penyewa/Pemilik.',
      );
    }

    const targetRole = String(rawRole || '').trim().toUpperCase();
    if (targetRole !== 'PENYEWA' && targetRole !== 'PEMILIK_KOST') {
      throw new BadRequestException(
        'Mode peran harus Penyewa atau Pemilik Properti.',
      );
    }

    const effectiveRoles = this._getEffectiveRoles(user);
    if (!effectiveRoles.includes(targetRole)) {
      throw new ForbiddenException(
        'Akun Anda belum terdaftar pada peran tersebut. Silakan daftar terlebih dahulu.',
      );
    }

    user.role = targetRole;
    user.roles = effectiveRoles;

    const saved = await this.userRepository.save(user);
    const accessToken = signAuthToken({
      userId: saved.id,
      role: saved.role,
      email: saved.email,
    });

    return {
      user: this.sanitizeUser(saved, true),
      accessToken,
    };
  }

  private _normalizeFcmTokens(user: User): string[] {
    const existing = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
    const merged = [...existing, user.fcmToken]
      .map((t) => (t || '').trim())
      .filter(Boolean);
    return Array.from(new Set(merged));
  }

  private async _applyFcmTokenUpdate(
    user: User,
    fcmToken: string,
    removeToken?: string,
  ): Promise<void> {
    const trimmed = (fcmToken || '').trim();
    const toRemove = (removeToken || '').trim();
    let list = this._normalizeFcmTokens(user);

    if (trimmed.length > 0) {
      await this.userRepository
        .createQueryBuilder()
        .update(User)
        .set({ fcmToken: '' })
        .where('fcmToken = :token AND id != :id', { token: trimmed, id: user.id })
        .execute();
      await this.userRepository.query(
        `UPDATE users SET "fcmTokens" = COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("fcmTokens") AS elem WHERE elem <> $1), '[]'::jsonb) WHERE id <> $2 AND "fcmTokens" @> $3::jsonb`,
        [trimmed, user.id, JSON.stringify([trimmed])],
      );
      list = [...list.filter((t) => t !== trimmed), trimmed].slice(-10);
      user.fcmTokens = list;
      user.fcmToken = trimmed;
      return;
    }

    const targetRemove = toRemove || (user.fcmToken || '').trim();
    if (targetRemove) {
      list = list.filter((t) => t !== targetRemove);
    } else if (list.length <= 1) {
      list = [];
    }
    user.fcmTokens = list;
    user.fcmToken = list[list.length - 1] || '';
  }

  async updateFcmToken(
    id: number,
    fcmToken: string,
    removeToken?: string,
  ): Promise<{ updated: boolean }> {
    const user = await this.findOne(id);
    await this._applyFcmTokenUpdate(user, fcmToken, removeToken);
    await this.userRepository.save(user);
    return { updated: true };
  }

  async getFcmTokens(id: number): Promise<string[]> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) return [];
    return this._normalizeFcmTokens(user);
  }

  async getFcmToken(id: number): Promise<string | null> {
    const tokens = await this.getFcmTokens(id);
    return tokens.length > 0 ? tokens[tokens.length - 1] : null;
  }

  async setBanStatus(
    id: number,
    isBanned: boolean,
    requesterId: number,
    requesterRole?: string,
  ): Promise<User> {
    if (id === 1) {
      throw new ForbiddenException(
        'Administrator utama (ID 1) tidak dapat dibanned.',
      );
    }
    if (id === requesterId) {
      throw new ForbiddenException(
        'Anda tidak dapat mem-banned akun Anda sendiri.',
      );
    }
    const user = await this.findOne(id);
    const reqRole = (requesterRole || '').toUpperCase();
    const targetRole = (user.role || '').toUpperCase();
    if (
      reqRole === 'STAFF' &&
      (targetRole === 'STAFF' || targetRole === 'ADMINISTRATOR')
    ) {
      throw new ForbiddenException(
        'Staff hanya dapat mem-banned akun Penyewa atau Pemilik Kost.',
      );
    }
    user.isBanned = isBanned;
    user.bannedAt = isBanned ? new Date() : null;
    if (isBanned) {
      user.fcmToken = '';
      user.fcmTokens = [];
    }
    const saved = await this.userRepository.save(user);
    void this.platformService?.recordEvent({
      level: 'WARN',
      category: 'AUTH',
      actorUserId: requesterId,
      message: `Pengguna userId=${id} ${isBanned ? 'DIBANNED' : 'DI-UNBAN'}`,
      meta: { targetUserId: id, isBanned },
    });
    return saved;
  }

  async requestOwnerVerification(
    userId: number,
    body: {
      kostId?: number | null;
      preferredDate?: string;
      phone?: string;
      notes?: string;
    },
  ): Promise<User> {
    const user = await this.findOne(userId);
    const role = (user.role || '').toUpperCase();
    const requestedKostId =
      body.kostId !== undefined && body.kostId !== null && Number(body.kostId) > 0
        ? Number(body.kostId)
        : null;
    if (role === 'STAFF' || role === 'ADMINISTRATOR') {
      throw new BadRequestException('Akun Anda sudah terverifikasi.');
    }
    if (!requestedKostId && user.isVerified) {
      throw new BadRequestException('Akun Anda sudah terverifikasi.');
    }
    if (requestedKostId) {
      const targetKost = await this.kostRepository.findOne({
        where: { id: requestedKostId },
      });
      if (!targetKost) {
        throw new NotFoundException('Properti tidak ditemukan.');
      }
      if (targetKost.ownerId === user.id) {
        throw new BadRequestException('Properti ini sudah menjadi milik Anda.');
      }
      const currentOwner = targetKost.ownerId
        ? await this.userRepository.findOne({ where: { id: targetKost.ownerId } })
        : null;
      const currentOwnerRole = (currentOwner?.role || '').toUpperCase();
      if (currentOwnerRole !== 'STAFF' && currentOwnerRole !== 'ADMINISTRATOR') {
        throw new BadRequestException('Properti ini tidak tersedia untuk diklaim.');
      }
    }
    const preferredDate = (body.preferredDate || '').trim();
    const nextPhone = normalizeIndonesianPhoneOrThrow(
      (body.phone || user.phone || '').trim(),
    );
    user.phone = nextPhone;
    user.verificationStatus = 'PENDING';
    user.verificationSurveyDate = preferredDate;
    user.verificationKostId = requestedKostId;
    user.verificationNotes = (body.notes || '').trim();
    user.verificationRejectionReason = '';
    return this.userRepository.save(user);
  }

  async setVerificationStatus(
    id: number,
    params: {
      isVerified?: boolean;
      status?: string;
      rejectionReason?: string;
    },
  ): Promise<User> {
    const user = await this.findOne(id);
    const normalizedStatus = (params.status || '').trim().toUpperCase();
    if (normalizedStatus === 'REJECTED') {
      if (!user.verificationKostId) {
        user.isVerified = false;
      }
      user.verificationStatus = 'REJECTED';
      user.verificationKostId = null;
      user.verificationRejectionReason = (params.rejectionReason || '').trim();
      const savedRejected = await this.userRepository.save(user);
      if (savedRejected.email) {
        void this.mailService?.sendEmail(savedRejected.email, {
          subject: '[Keyloka] Pengajuan Verifikasi / Klaim Ditolak',
          badgeText: 'Verifikasi Ditolak',
          badgeTone: 'red',
          title: 'Pengajuan Verifikasi Belum Disetujui',
          greetingName: savedRejected.name,
          intro:
            'Mohon maaf, pengajuan verifikasi akun atau klaim properti Anda belum dapat disetujui oleh tim kami.',
          details: savedRejected.verificationRejectionReason
            ? [
                {
                  label: 'Alasan Penolakan',
                  value: savedRejected.verificationRejectionReason,
                },
              ]
            : undefined,
          ctaLabel: 'Periksa Profil Anda',
          ctaUrl: '/profile',
        });
      }
      return savedRejected;
    }
    const verified =
      params.isVerified !== undefined
        ? Boolean(params.isVerified)
        : normalizedStatus === 'VERIFIED';
    if (verified && user.verificationKostId) {
      const targetKost = await this.kostRepository.findOne({
        where: { id: user.verificationKostId },
      });
      if (targetKost && targetKost.ownerId !== user.id) {
        const currentOwner = targetKost.ownerId
          ? await this.userRepository.findOne({ where: { id: targetKost.ownerId } })
          : null;
        const currentOwnerRole = (currentOwner?.role || '').toUpperCase();
        if (currentOwnerRole === 'STAFF' || currentOwnerRole === 'ADMINISTRATOR') {
          targetKost.ownerId = user.id;
          targetKost.ownerName = user.name.trim() || targetKost.ownerName;
          if (user.phone && user.phone.trim()) {
            targetKost.ownerPhone = user.phone.trim();
          }
          await this.kostRepository.save(targetKost);
          if ((user.role || '').toUpperCase() === 'PENYEWA') {
            user.roles = ['PENYEWA', 'PEMILIK_KOST'];
            user.role = 'PEMILIK_KOST';
          }
        }
      }
      user.verificationKostId = null;
    } else if (!verified) {
      user.verificationKostId = null;
    }
    user.isVerified = verified;
    user.verificationStatus = verified ? 'VERIFIED' : 'NONE';
    user.verificationRejectionReason = '';
    return this.userRepository.save(user);
  }

  async getDeletionSummary(id: number): Promise<{
    kostCount: number;
    articleCount: number;
    postCount: number;
    bookingCount: number;
    reviewCount: number;
    favoriteCount: number;
    payoutBalance: number;
    creditBalance: number;
  }> {
    const user = await this.findOne(id);
    const manager = this.userRepository.manager;
    const [
      kostCount,
      articleCount,
      postCount,
      bookingCount,
      reviewCount,
      favoriteCount,
    ] = await Promise.all([
      manager.count(Kost, { where: { ownerId: id } }),
      manager.count(Article, { where: { authorId: id } }),
      manager.count(OwnerPost, { where: { ownerId: id } }),
      manager
        .createQueryBuilder(Booking, 'b')
        .where('b.userId = :id OR b.ownerId = :id', { id })
        .getCount(),
      manager.count(Review, { where: { userId: id } }),
      manager.count(UserFavorite, { where: { userId: id } }),
    ]);

    return {
      kostCount,
      articleCount,
      postCount,
      bookingCount,
      reviewCount,
      favoriteCount,
      payoutBalance: Number(user.payoutBalance || 0),
      creditBalance: Number(user.creditBalance || 0),
    };
  }

  async remove(
    id: number,
    requesterId?: number,
  ): Promise<{ deleted: boolean; id: number }> {
    if (id === 1) {
      throw new BadRequestException(
        'Administrator utama (ID 1) tidak dapat dihapus',
      );
    }
    const user = await this.findOne(id);
    if (
      requesterId &&
      requesterId !== id &&
      (user.role || '').toUpperCase() === 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Akun Administrator lain tidak dapat dihapus.',
      );
    }

    const manager = this.userRepository.manager;
    const [activeEscrowCount, pendingPayoutCount] = await Promise.all([
      manager
        .createQueryBuilder(Booking, 'b')
        .where('(b.userId = :id OR b.ownerId = :id)', { id })
        .andWhere('b.escrowStatus IN (:...statuses)', {
          statuses: ['HELD', 'DISPUTED'],
        })
        .getCount(),
      manager.count(PayoutRequest, {
        where: { userId: id, status: 'PENDING' },
      }),
    ]);

    if (activeEscrowCount > 0) {
      throw new BadRequestException(
        'Akun tidak dapat dihapus karena masih memiliki transaksi Escrow yang sedang ditahan atau dalam sengketa.',
      );
    }
    if (pendingPayoutCount > 0) {
      throw new BadRequestException(
        'Akun tidak dapat dihapus karena masih memiliki pengajuan penarikan dana (withdraw) yang sedang diproses.',
      );
    }
    if (
      (!requesterId || requesterId === id) &&
      Number(user.payoutBalance ?? 0) > 0
    ) {
      throw new BadRequestException(
        'Akun Anda masih memiliki saldo penghasilan sewa yang belum ditarik. Silakan tarik dana terlebih dahulu sebelum menghapus akun.',
      );
    }

    const imagesToDelete = new Set<string>();
    if (user.avatarUrl) imagesToDelete.add(user.avatarUrl);
    if (user.coverUrl) imagesToDelete.add(user.coverUrl);

    await this.userRepository.manager.transaction(async (manager) => {
      const ownedKosts = await manager.find(Kost, {
        where: { ownerId: id },
        select: ['id', 'images'],
      });
      const ownedKostIds = ownedKosts.map((k) => k.id);
      for (const k of ownedKosts) {
        if (Array.isArray(k.images)) {
          for (const img of k.images) {
            if (img) imagesToDelete.add(img);
          }
        }
      }

      const ownedPosts = await manager.find(OwnerPost, {
        where: { ownerId: id },
        select: ['id', 'imageUrl'],
      });
      const ownedPostIds = ownedPosts.map((p) => p.id);
      for (const p of ownedPosts) {
        if (p.imageUrl) imagesToDelete.add(p.imageUrl);
      }

      const ownedArticles = await manager.find(Article, {
        where: { authorId: id },
        select: ['id', 'coverImageUrl', 'contentHtml'],
      });
      for (const a of ownedArticles) {
        if (a.coverImageUrl) imagesToDelete.add(a.coverImageUrl);
        for (const htmlImg of this.storageService.extractManagedImageUrlsFromHtml(
          a.contentHtml,
        )) {
          imagesToDelete.add(htmlImg);
        }
      }

      // Clean up child & related records before removing user & owned kosts
      await manager.delete(Notification, { userId: id });
      await manager.delete(UserFavorite, { userId: id });
      await manager.delete(PointTransaction, { userId: id });
      await manager.delete(WalletTransaction, { userId: id });
      await manager.delete(PayoutRequest, { userId: id });
      await manager.delete(ReviewReport, { reporterId: id });
      await manager.delete(KostReport, { reporterId: id });
      await manager.delete(Review, { userId: id });
      await manager.delete(OwnerPostComment, { userId: id });
      await manager.delete(OwnerPostLike, { userId: id });
      if (ownedPostIds.length > 0) {
        await manager.delete(OwnerPostComment, { postId: In(ownedPostIds) });
        await manager.delete(OwnerPostLike, { postId: In(ownedPostIds) });
      }
      await manager.delete(OwnerPost, { ownerId: id });
      await manager
        .createQueryBuilder()
        .delete()
        .from(ChatMessage)
        .where('senderId = :id OR receiverId = :id', { id })
        .execute();
      await manager.delete(KostGroupMessage, { senderId: id });
      await manager
        .createQueryBuilder()
        .delete()
        .from(Booking)
        .where('userId = :id OR ownerId = :id', { id })
        .execute();

      if (ownedKostIds.length > 0) {
        await manager.delete(KostGroupMessage, { kostId: In(ownedKostIds) });
        await manager.delete(KostGroupSetting, { kostId: In(ownedKostIds) });
        await manager.delete(KostReport, { kostId: In(ownedKostIds) });
        await manager.delete(UserFavorite, { kostId: In(ownedKostIds) });
        await manager.delete(Review, { kostId: In(ownedKostIds) });
        await manager.delete(Kost, { id: In(ownedKostIds) });
      }

      await manager.delete(Article, { authorId: id });
      await manager.delete(User, { id });
    });

    if (imagesToDelete.size > 0) {
      void Promise.allSettled(
        Array.from(imagesToDelete).map((url) =>
          this.storageService.deleteByUrl(url),
        ),
      );
    }
    return { deleted: true, id };
  }
}
