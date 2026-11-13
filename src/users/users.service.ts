import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { GoogleAuthDto, UpdateUserDto } from './dto/google-auth.dto';

export const GOOGLE_OAUTH_CONFIG = {
  clientId:
    '946056205847-4rh8tk8j7oha26gh9fs80olh43juh77m.apps.googleusercontent.com',
  projectId: 'celestial-gecko-465811-m4',
  authUri: 'https://accounts.google.com/o/oauth2/auth',
  tokenUri: 'https://oauth2.googleapis.com/token',
  authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async loginOrRegisterWithGoogle(dto: GoogleAuthDto): Promise<{
    user: User;
    isNewUser: boolean;
  }> {
    let googleId = dto.googleId?.trim();
    let email = dto.email?.trim().toLowerCase();
    let name = dto.name?.trim();
    let avatarUrl = dto.avatarUrl?.trim();

    // If accessToken is provided, optionally verify/enrich against Google userinfo endpoint
    if (dto.accessToken) {
      try {
        const res = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${dto.accessToken}` },
          },
        );
        if (res.ok) {
          const info = (await res.json()) as {
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
          };
          if (info.sub) googleId = info.sub;
          if (info.email) email = info.email.toLowerCase();
          if (info.name) name = info.name;
          if (info.picture) avatarUrl = info.picture;
        }
      } catch (_) {
        // Fallback to client-provided GoogleSignInAccount fields if offline/restricted
      }
    }

    // If idToken is provided, optionally verify/enrich against Google tokeninfo endpoint
    if (dto.idToken) {
      try {
        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`,
        );
        if (res.ok) {
          const info = (await res.json()) as {
            sub?: string;
            email?: string;
            name?: string;
            picture?: string;
          };
          if (info.sub) googleId = info.sub;
          if (info.email) email = info.email.toLowerCase();
          if (info.name) name = info.name;
          if (info.picture) avatarUrl = info.picture;
        }
      } catch (_) {}
    }

    if (!email || !googleId) {
      throw new BadRequestException(
        'Data akun Google (googleId dan email) wajib diisi',
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
        lastLoginAt: new Date(),
      });
    } else {
      user.googleId = googleId;
      user.email = email;
      if (!user.name || user.name.trim().length === 0) {
        user.name = displayName;
      }
      // Simpan foto profil jika sebelumnya masih kosong, atau perbarui jika mendapat foto asli Google
      if (
        !user.avatarUrl ||
        user.avatarUrl.trim().length === 0 ||
        (avatarUrl && avatarUrl.includes('googleusercontent.com'))
      ) {
        user.avatarUrl = resolvedAvatarUrl;
      }
      user.lastLoginAt = new Date();
    }

    const saved = await this.userRepository.save(user);
    return {
      user: saved,
      isNewUser,
    };
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      order: { id: 'ASC' },
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User dengan ID ${id} tidak ditemukan`);
    }
    return user;
  }

  async updateProfile(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    if (dto.name !== undefined && dto.name.trim().length > 0) {
      user.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      user.phone = dto.phone.trim();
    }
    if (dto.role !== undefined && dto.role.trim().length > 0) {
      user.role = dto.role.trim().toUpperCase();
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
    return this.userRepository.save(user);
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    if (id === 1) {
      throw new BadRequestException(
        'Administrator utama (ID 1) tidak dapat dihapus',
      );
    }
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
    return { deleted: true, id };
  }
}
