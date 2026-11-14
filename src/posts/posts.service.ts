import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OwnerPost } from './entities/owner-post.entity';
import { User } from '../users/entities/user.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { CreateOwnerPostDto, UpdateOwnerPostDto } from './dto/owner-post.dto';

export interface OwnerPostResponse {
  id: number;
  ownerId: number;
  content: string;
  imageUrl: string | null;
  kostId: number | null;
  kostName: string | null;
  kostType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(OwnerPost)
    private readonly postRepository: Repository<OwnerPost>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
  ) {}

  private async attachKostMetadata(
    posts: OwnerPost[],
  ): Promise<OwnerPostResponse[]> {
    const kostIds = Array.from(
      new Set(
        posts
          .map((p) => p.kostId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    );
    const kostMap = new Map<number, Kost>();
    if (kostIds.length > 0) {
      const kosts = await this.kostRepository.find({
        where: { id: In(kostIds) },
      });
      for (const k of kosts) {
        kostMap.set(k.id, k);
      }
    }

    return posts.map((post) => {
      const kost = post.kostId ? kostMap.get(post.kostId) : undefined;
      return {
        id: post.id,
        ownerId: post.ownerId,
        content: post.content,
        imageUrl: post.imageUrl,
        kostId: post.kostId,
        kostName: kost?.name ?? null,
        kostType: kost?.propertyCategory ?? null,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };
    });
  }

  async findByOwner(ownerId: number): Promise<OwnerPostResponse[]> {
    const posts = await this.postRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return this.attachKostMetadata(posts);
  }

  async create(dto: CreateOwnerPostDto): Promise<OwnerPostResponse> {
    const owner = await this.userRepository.findOne({
      where: { id: dto.ownerId },
    });
    if (!owner) {
      throw new NotFoundException('Pemilik tidak ditemukan.');
    }

    const role = (owner.role || '').toUpperCase();
    if (role !== 'PEMILIK_KOST' && role !== 'STAFF' && role !== 'ADMINISTRATOR') {
      throw new ForbiddenException(
        'Hanya Pemilik Properti, Staff, atau Admin yang dapat membuat postingan.',
      );
    }

    const trimmedContent = dto.content.trim();
    if (!trimmedContent) {
      throw new BadRequestException('Isi postingan tidak boleh kosong.');
    }

    let validKostId: number | null = null;
    if (dto.kostId !== undefined && dto.kostId !== null) {
      const kost = await this.kostRepository.findOne({
        where: { id: dto.kostId },
      });
      if (!kost || (kost.ownerId !== owner.id && role === 'PEMILIK_KOST')) {
        throw new ForbiddenException(
          'Properti yang ditautkan bukan milik akun ini.',
        );
      }
      validKostId = kost.id;
    }

    const post = this.postRepository.create({
      ownerId: owner.id,
      content: trimmedContent,
      imageUrl: dto.imageUrl?.trim() || null,
      kostId: validKostId,
    });
    const saved = await this.postRepository.save(post);
    const [enriched] = await this.attachKostMetadata([saved]);
    return enriched;
  }

  private async verifyPostEditor(post: OwnerPost, requesterId: number) {
    if (post.ownerId === requesterId) return;
    const requester = await this.userRepository.findOne({
      where: { id: requesterId },
    });
    const role = (requester?.role || '').toUpperCase();
    if (role !== 'STAFF' && role !== 'ADMINISTRATOR') {
      throw new ForbiddenException(
        'Anda tidak memiliki izin mengubah postingan ini.',
      );
    }
  }

  async update(
    id: number,
    dto: UpdateOwnerPostDto,
  ): Promise<OwnerPostResponse> {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }

    await this.verifyPostEditor(post, dto.requesterId);

    if (dto.content !== undefined) {
      const trimmed = dto.content.trim();
      if (!trimmed) {
        throw new BadRequestException('Isi postingan tidak boleh kosong.');
      }
      post.content = trimmed;
    }

    if (dto.imageUrl !== undefined) {
      post.imageUrl = dto.imageUrl.trim() || null;
    }

    if (dto.kostId !== undefined) {
      if (dto.kostId === null) {
        post.kostId = null;
      } else {
        const kost = await this.kostRepository.findOne({
          where: { id: dto.kostId },
        });
        if (!kost || kost.ownerId !== post.ownerId) {
          throw new ForbiddenException(
            'Properti yang ditautkan bukan milik pemilik postingan.',
          );
        }
        post.kostId = kost.id;
      }
    }

    const saved = await this.postRepository.save(post);
    const [enriched] = await this.attachKostMetadata([saved]);
    return enriched;
  }

  async remove(id: number, requesterId: number): Promise<{ deleted: boolean }> {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }

    await this.verifyPostEditor(post, requesterId);
    await this.postRepository.remove(post);
    return { deleted: true };
  }
}
