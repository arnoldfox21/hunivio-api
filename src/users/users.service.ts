import * as crypto from 'crypto';
import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import {
  GoogleAuthDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  CompleteOnboardingDto,
  EmailLoginDto,
  SetPasswordDto,
} from './dto/google-auth.dto';
import { signAuthToken } from '../auth/jwt.util';

export const GOOGLE_OAUTH_CONFIG = {
  clientId:
    '946056205847-4rh8tk8j7oha26gh9fs80olh43juh77m.apps.googleusercontent.com',
  projectId: 'celestial-gecko-465811-m4',
  authUri: 'https://accounts.google.com/o/oauth2/auth',
  tokenUri: 'https://oauth2.googleapis.com/token',
  authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
};

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit() {
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
      isVerified: Boolean(user.isVerified) || isStaffOrAdmin,
      verificationStatus: isStaffOrAdmin
        ? 'VERIFIED'
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
      qb.andWhere('UPPER(user.role) = :role', {
        role: query.role.trim().toUpperCase(),
      });
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
      user.phone = dto.phone.trim();
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
      user.username = dto.username.trim().replace(/^@+/, '');
    }
    if (dto.bio !== undefined) {
      user.bio = dto.bio.trim();
    }
    if (dto.city !== undefined) {
      user.city = dto.city.trim();
    }
    if (dto.avatarUrl !== undefined && dto.avatarUrl.trim().length > 0) {
      user.avatarUrl = dto.avatarUrl.trim();
    }
    if (dto.coverUrl !== undefined) {
      user.coverUrl = dto.coverUrl.trim();
    }
    if (dto.fcmToken !== undefined) {
      user.fcmToken = dto.fcmToken.trim();
    }
    return this.userRepository.save(user);
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
    const allowedRoles = ['PENYEWA', 'PEMILIK_KOST', 'STAFF', 'ADMINISTRATOR'];
    if (!allowedRoles.includes(normalizedRole)) {
      throw new BadRequestException('Peran pengguna tidak valid.');
    }

    user.role = normalizedRole;
    return this.userRepository.save(user);
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
    if (normalizedRole !== 'PENYEWA' && normalizedRole !== 'PEMILIK_KOST') {
      throw new BadRequestException(
        'Pilih peran sebagai Penyewa atau Pemilik Properti.',
      );
    }

    user.role = normalizedRole;
    if (dto.preferredCategory !== undefined) {
      user.preferredCategory = dto.preferredCategory.trim();
    }
    if (dto.city !== undefined && dto.city.trim().length > 0) {
      user.city = dto.city.trim();
    }
    if (dto.phone !== undefined && dto.phone.trim().length > 0) {
      user.phone = dto.phone.trim();
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

  async updateFcmToken(
    id: number,
    fcmToken: string,
  ): Promise<{ updated: boolean }> {
    const user = await this.findOne(id);
    const trimmed = (fcmToken || '').trim();
    if (trimmed.length > 0) {
      await this.userRepository
        .createQueryBuilder()
        .update(User)
        .set({ fcmToken: '' })
        .where('fcmToken = :token AND id != :id', { token: trimmed, id })
        .execute();
    }
    user.fcmToken = trimmed;
    await this.userRepository.save(user);
    return { updated: true };
  }

  async getFcmToken(id: number): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id } });
    const token = user?.fcmToken?.trim();
    return token && token.length > 0 ? token : null;
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
    }
    return this.userRepository.save(user);
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
    if (role === 'STAFF' || role === 'ADMINISTRATOR' || user.isVerified) {
      throw new BadRequestException('Akun Anda sudah terverifikasi.');
    }
    const preferredDate = (body.preferredDate || '').trim();
    if (!preferredDate) {
      throw new BadRequestException('Tanggal rencana survei wajib diisi.');
    }
    const nextPhone = (body.phone || user.phone || '').trim();
    if (!nextPhone || nextPhone.length < 8) {
      throw new BadRequestException(
        'Nomor WhatsApp aktif wajib diisi agar Staff dapat berkoordinasi.',
      );
    }
    user.phone = nextPhone;
    user.verificationStatus = 'PENDING';
    user.verificationSurveyDate = preferredDate;
    user.verificationKostId =
      body.kostId !== undefined && body.kostId !== null && Number(body.kostId) > 0
        ? Number(body.kostId)
        : null;
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
      user.isVerified = false;
      user.verificationStatus = 'REJECTED';
      user.verificationRejectionReason = (params.rejectionReason || '').trim();
      return this.userRepository.save(user);
    }
    const verified =
      params.isVerified !== undefined
        ? Boolean(params.isVerified)
        : normalizedStatus === 'VERIFIED';
    user.isVerified = verified;
    user.verificationStatus = verified ? 'VERIFIED' : 'NONE';
    user.verificationRejectionReason = '';
    return this.userRepository.save(user);
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
    await this.userRepository.remove(user);
    return { deleted: true, id };
  }
}
