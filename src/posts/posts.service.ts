import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OwnerPost } from './entities/owner-post.entity';
import { OwnerPostComment } from './entities/owner-post-comment.entity';
import { OwnerPostLike } from './entities/owner-post-like.entity';
import { User } from '../users/entities/user.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { CreateOwnerPostDto, UpdateOwnerPostDto } from './dto/owner-post.dto';
import { StorageService } from '../storage/storage.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

export interface OwnerPostResponse {
  id: number;
  ownerId: number;
  content: string;
  imageUrl: string | null;
  kostId: number | null;
  kostName: string | null;
  kostType: string | null;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerPostCommentResponse {
  id: number;
  postId: number;
  userId: number;
  userName: string;
  userAvatarUrl: string;
  userRole: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PostsService {
  private readonly _postRateHits = new Map<
    number,
    { count: number; resetAt: number }
  >();
  private readonly _commentRateHits = new Map<
    number,
    { count: number; resetAt: number; lastText: string }
  >();

  constructor(
    @InjectRepository(OwnerPost)
    private readonly postRepository: Repository<OwnerPost>,
    @InjectRepository(OwnerPostComment)
    private readonly commentRepository: Repository<OwnerPostComment>,
    @InjectRepository(OwnerPostLike)
    private readonly likeRepository: Repository<OwnerPostLike>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
    private readonly storageService: StorageService,
  ) {}

  private _checkPostRateLimit(userId: number): void {
    const now = Date.now();
    const entry = this._postRateHits.get(userId);
    if (!entry || now > entry.resetAt) {
      this._postRateHits.set(userId, { count: 1, resetAt: now + 60_000 });
      return;
    }
    entry.count += 1;
    if (entry.count > 5) {
      throw new HttpException(
        'Terlalu banyak membuat postingan dalam waktu singkat. Tunggu 1 menit.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private _checkCommentRateLimit(userId: number, text: string): void {
    const now = Date.now();
    const entry = this._commentRateHits.get(userId);
    if (!entry || now > entry.resetAt) {
      this._commentRateHits.set(userId, {
        count: 1,
        resetAt: now + 60_000,
        lastText: text,
      });
      return;
    }
    if (entry.lastText === text) {
      throw new BadRequestException(
        'Komentar yang sama baru saja dikirim. Hindari mengirim komentar berulang.',
      );
    }
    entry.count += 1;
    entry.lastText = text;
    if (entry.count > 6) {
      throw new HttpException(
        'Terlalu banyak mengirim komentar dalam waktu singkat. Tunggu 1 menit.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async _resolvePostImageUrl(
    rawImageUrl?: string | null,
  ): Promise<string | null> {
    const trimmed = (rawImageUrl || '').trim();
    if (!trimmed) return null;
    if (!/^data:image\//i.test(trimmed)) {
      return this.storageService.resolvePublicUrl(trimmed);
    }
    const base64Data = trimmed.includes(',')
      ? trimmed.split(',').pop() || ''
      : trimmed;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException(
        'Ukuran gambar postingan tidak valid (maksimal 8 MB).',
      );
    }
    let outputBuffer: Buffer = buffer;
    let outputExt = 'webp';
    try {
      outputBuffer = await sharp(buffer, { limitInputPixels: 100_000_000 })
        .rotate()
        .resize({
          width: 1440,
          height: 1440,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch {
      outputBuffer = buffer;
      outputExt = 'jpg';
    }
    const key = this.storageService.buildKostImageKey(outputExt);
    const uploaded = await this.storageService.uploadBuffer(
      outputBuffer,
      key,
      outputExt === 'webp' ? 'image/webp' : 'image/jpeg',
    );
    return uploaded.url;
  }

  private async attachKostMetadata(
    posts: OwnerPost[],
    viewerId?: number,
  ): Promise<OwnerPostResponse[]> {
    if (posts.length === 0) return [];
    const postIds = posts.map((p) => p.id);
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

    const [likeCountsRaw, commentCountsRaw, viewerLikesRaw] = await Promise.all([
      this.likeRepository
        .createQueryBuilder('l')
        .select('l.postId', 'postId')
        .addSelect('COUNT(*)', 'cnt')
        .where('l.postId IN (:...postIds)', { postIds })
        .groupBy('l.postId')
        .getRawMany<{ postId: number; cnt: string }>(),
      this.commentRepository
        .createQueryBuilder('c')
        .select('c.postId', 'postId')
        .addSelect('COUNT(*)', 'cnt')
        .where('c.postId IN (:...postIds)', { postIds })
        .groupBy('c.postId')
        .getRawMany<{ postId: number; cnt: string }>(),
      viewerId
        ? this.likeRepository.find({
            select: ['postId'],
            where: { postId: In(postIds), userId: viewerId },
          })
        : Promise.resolve([] as OwnerPostLike[]),
    ]);

    const likeCountMap = new Map<number, number>();
    for (const row of likeCountsRaw) {
      likeCountMap.set(Number(row.postId), Number(row.cnt) || 0);
    }
    const likedPostIds = new Set<number>(viewerLikesRaw.map((l) => l.postId));

    const commentCountMap = new Map<number, number>();
    for (const row of commentCountsRaw) {
      commentCountMap.set(Number(row.postId), Number(row.cnt) || 0);
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
        likeCount: likeCountMap.get(post.id) ?? 0,
        commentCount: commentCountMap.get(post.id) ?? 0,
        isLiked: likedPostIds.has(post.id),
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };
    });
  }

  async findByOwner(
    ownerId: number,
    viewerId?: number,
  ): Promise<OwnerPostResponse[]> {
    const posts = await this.postRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 30,
    });
    return this.attachKostMetadata(posts, viewerId);
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
    if (trimmedContent.length > 3000) {
      throw new BadRequestException(
        'Isi postingan maksimal 3.000 karakter.',
      );
    }
    this._checkPostRateLimit(owner.id);

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

    const resolvedImageUrl = await this._resolvePostImageUrl(dto.imageUrl);
    const post = this.postRepository.create({
      ownerId: owner.id,
      content: trimmedContent,
      imageUrl: resolvedImageUrl,
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

    const previousImageUrl = post.imageUrl;
    if (dto.imageUrl !== undefined) {
      post.imageUrl = await this._resolvePostImageUrl(dto.imageUrl);
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
    if (
      dto.imageUrl !== undefined &&
      previousImageUrl &&
      previousImageUrl !== saved.imageUrl
    ) {
      void this.storageService.deleteByUrl(previousImageUrl);
    }
    const [enriched] = await this.attachKostMetadata([saved]);
    return enriched;
  }

  async remove(id: number, requesterId: number): Promise<{ deleted: boolean }> {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }

    const imageUrlToDelete = post.imageUrl;
    await this.verifyPostEditor(post, requesterId);
    await this.commentRepository.delete({ postId: id });
    await this.likeRepository.delete({ postId: id });
    await this.postRepository.remove(post);
    if (imageUrlToDelete) {
      void this.storageService.deleteByUrl(imageUrlToDelete);
    }
    return { deleted: true };
  }

  private async attachCommentAuthors(
    comments: OwnerPostComment[],
  ): Promise<OwnerPostCommentResponse[]> {
    if (comments.length === 0) return [];
    const userIds = Array.from(new Set(comments.map((c) => c.userId)));
    const users = await this.userRepository.find({
      where: { id: In(userIds) },
    });
    const userMap = new Map<number, User>();
    for (const u of users) {
      userMap.set(u.id, u);
    }

    return comments.map((c) => {
      const u = userMap.get(c.userId);
      return {
        id: c.id,
        postId: c.postId,
        userId: c.userId,
        userName: u?.name ?? 'Pengguna',
        userAvatarUrl: u?.avatarUrl ?? '',
        userRole: u?.role ?? 'PENCARI_KOST',
        content: c.content,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
  }

  async getComments(postId: number): Promise<OwnerPostCommentResponse[]> {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }
    const comments = await this.commentRepository.find({
      where: { postId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.attachCommentAuthors(comments);
  }

  async addComment(
    postId: number,
    userId: number,
    content: string,
  ): Promise<OwnerPostCommentResponse> {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new BadRequestException('Komentar tidak boleh kosong.');
    }
    if (trimmed.length > 1000) {
      throw new BadRequestException('Komentar maksimal 1.000 karakter.');
    }
    this._checkCommentRateLimit(userId, trimmed);
    const saved = await this.commentRepository.save(
      this.commentRepository.create({
        postId,
        userId,
        content: trimmed,
      }),
    );
    const [enriched] = await this.attachCommentAuthors([saved]);
    return enriched;
  }

  async removeComment(
    postId: number,
    commentId: number,
    requesterId: number,
  ): Promise<{ deleted: boolean }> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId, postId },
    });
    if (!comment) {
      throw new NotFoundException('Komentar tidak ditemukan.');
    }
    if (comment.userId !== requesterId) {
      const post = await this.postRepository.findOne({ where: { id: postId } });
      if (!post || post.ownerId !== requesterId) {
        const requester = await this.userRepository.findOne({
          where: { id: requesterId },
        });
        const role = (requester?.role || '').toUpperCase();
        if (role !== 'STAFF' && role !== 'ADMINISTRATOR') {
          throw new ForbiddenException(
            'Anda tidak memiliki izin menghapus komentar ini.',
          );
        }
      }
    }
    await this.commentRepository.remove(comment);
    return { deleted: true };
  }

  async toggleLike(
    postId: number,
    userId: number,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Postingan tidak ditemukan.');
    }
    const existing = await this.likeRepository.findOne({
      where: { postId, userId },
    });
    let liked = false;
    if (existing) {
      await this.likeRepository.remove(existing);
      liked = false;
    } else {
      await this.likeRepository.save(
        this.likeRepository.create({ postId, userId }),
      );
      liked = true;
    }
    const likeCount = await this.likeRepository.count({ where: { postId } });
    return { liked, likeCount };
  }
}
