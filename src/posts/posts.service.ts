import {
  BadRequestException,
  ForbiddenException,
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
  ) {}

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

    const [likes, comments] = await Promise.all([
      this.likeRepository.find({ where: { postId: In(postIds) } }),
      this.commentRepository.find({ where: { postId: In(postIds) } }),
    ]);

    const likeCountMap = new Map<number, number>();
    const likedPostIds = new Set<number>();
    for (const l of likes) {
      likeCountMap.set(l.postId, (likeCountMap.get(l.postId) ?? 0) + 1);
      if (viewerId && l.userId === viewerId) {
        likedPostIds.add(l.postId);
      }
    }

    const commentCountMap = new Map<number, number>();
    for (const c of comments) {
      commentCountMap.set(c.postId, (commentCountMap.get(c.postId) ?? 0) + 1);
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
    await this.commentRepository.delete({ postId: id });
    await this.likeRepository.delete({ postId: id });
    await this.postRepository.remove(post);
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
