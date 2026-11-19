import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import * as sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import { Article } from './entities/article.entity';
import { ArticleCategory } from './entities/article-category.entity';
import {
  CreateArticleCategoryDto,
  CreateArticleDto,
  UpdateArticleCategoryDto,
  UpdateArticleDto,
} from './dto/article.dto';

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function sanitizeArticleHtml(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeReadingTimeMinutes(html: string): number {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const clean = (t || '').trim().toLowerCase().slice(0, 40);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out.slice(0, 12);
}

@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(Article)
    private readonly articleRepository: Repository<Article>,
    @InjectRepository(ArticleCategory)
    private readonly categoryRepository: Repository<ArticleCategory>,
    private readonly storageService: StorageService,
  ) {}

  private serializeArticle(article: Article) {
    return {
      ...article,
      coverImageUrl: article.coverImageUrl
        ? this.storageService.resolvePublicUrl(article.coverImageUrl)
        : null,
      author: article.author
        ? {
            id: article.author.id,
            name: article.author.name,
            avatarUrl: article.author.avatarUrl
              ? this.storageService.resolvePublicUrl(article.author.avatarUrl)
              : null,
            bio: article.author.bio || '',
          }
        : undefined,
    };
  }

  private async ensureUniqueSlug(
    desired: string,
    excludeId?: number,
  ): Promise<string> {
    const base = slugify(desired) || `artikel-${Date.now()}`;
    let candidate = base;
    let suffix = 2;
    while (true) {
      const existing = await this.articleRepository.findOne({
        where: excludeId
          ? { slug: candidate, id: Not(excludeId) }
          : { slug: candidate },
        select: ['id'],
      });
      if (!existing) return candidate;
      candidate = `${base.slice(0, 170)}-${suffix}`;
      suffix += 1;
    }
  }

  async findAllPublished(params: {
    q?: string;
    category?: string;
    tag?: string;
    featured?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, Math.max(1, params.limit || 12));

    const qb = this.articleRepository
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.author', 'author')
      .where('article.status = :status', { status: 'PUBLISHED' });

    if (params.q?.trim()) {
      const term = `%${params.q.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(article.title) LIKE :term OR LOWER(article.excerpt) LIKE :term OR LOWER(article.city) LIKE :term OR LOWER(article.tags) LIKE :term)',
        { term },
      );
    }

    if (params.category?.trim()) {
      qb.andWhere('UPPER(article.category) = :category', {
        category: params.category.trim().toUpperCase(),
      });
    }

    if (params.tag?.trim()) {
      qb.andWhere('LOWER(article.tags) LIKE :tag', {
        tag: `%${params.tag.trim().toLowerCase()}%`,
      });
    }

    if (params.featured === 'true') {
      qb.andWhere('article.isFeatured = :featured', { featured: true });
    }

    if ((params.sort || '').toLowerCase() === 'popular') {
      qb.orderBy('article.viewCount', 'DESC').addOrderBy(
        'article.publishedAt',
        'DESC',
      );
    } else {
      qb.orderBy('article.publishedAt', 'DESC').addOrderBy(
        'article.createdAt',
        'DESC',
      );
    }

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: items.map((a) => this.serializeArticle(a)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getFacets() {
    const rows = await this.articleRepository.find({
      where: { status: 'PUBLISHED' },
      select: ['category', 'tags'],
    });

    const categories: Record<string, number> = {};
    const tags: Record<string, number> = {};

    for (const row of rows) {
      if (row.category) {
        categories[row.category] = (categories[row.category] || 0) + 1;
      }
      if (Array.isArray(row.tags)) {
        for (const t of row.tags) {
          const clean = t.trim().toLowerCase();
          if (clean) tags[clean] = (tags[clean] || 0) + 1;
        }
      }
    }

    const topTags = Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    return { categories, topTags };
  }

  async findBySlug(slug: string) {
    const article = await this.articleRepository.findOne({
      where: { slug: slug.trim(), status: 'PUBLISHED' },
      relations: ['author'],
    });
    if (!article) {
      throw new NotFoundException('Artikel tidak ditemukan.');
    }

    await this.articleRepository.increment({ id: article.id }, 'viewCount', 1);
    article.viewCount += 1;

    return this.serializeArticle(article);
  }

  async findRelated(slug: string, limit = 4) {
    const current = await this.articleRepository.findOne({
      where: { slug: slug.trim(), status: 'PUBLISHED' },
    });
    if (!current) return [];

    const related = await this.articleRepository
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.author', 'author')
      .where('article.status = :status', { status: 'PUBLISHED' })
      .andWhere('article.id != :id', { id: current.id })
      .orderBy(
        'CASE WHEN article.category = :category THEN 0 ELSE 1 END',
        'ASC',
      )
      .addOrderBy('article.publishedAt', 'DESC')
      .setParameter('category', current.category)
      .take(Math.min(8, Math.max(1, limit)))
      .getMany();

    return related.map((a) => this.serializeArticle(a));
  }

  async findByAuthor(authorId: number, status?: string) {
    const qb = this.articleRepository
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.author', 'author')
      .where('article.authorId = :authorId', { authorId });

    if (status && ['DRAFT', 'PUBLISHED'].includes(status.toUpperCase())) {
      qb.andWhere('article.status = :status', {
        status: status.toUpperCase(),
      });
    }

    const list = await qb
      .orderBy('article.updatedAt', 'DESC')
      .getMany();

    return list.map((a) => this.serializeArticle(a));
  }

  async findAllForAdmin(status?: string) {
    const qb = this.articleRepository
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.author', 'author');

    if (status && ['DRAFT', 'PUBLISHED'].includes(status.toUpperCase())) {
      qb.andWhere('article.status = :status', {
        status: status.toUpperCase(),
      });
    }

    const list = await qb.orderBy('article.updatedAt', 'DESC').getMany();
    return list.map((a) => this.serializeArticle(a));
  }

  async findOneForAuthor(id: number, authorId: number) {
    const article = await this.articleRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!article) {
      throw new NotFoundException('Artikel tidak ditemukan.');
    }
    if (article.authorId !== authorId) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin mengakses artikel ini.',
      );
    }
    return this.serializeArticle(article);
  }

  async create(authorId: number, dto: CreateArticleDto) {
    const cleanHtml = sanitizeArticleHtml(dto.contentHtml);
    if (!stripHtml(cleanHtml)) {
      throw new BadRequestException('Konten artikel wajib diisi.');
    }

    const slug = await this.ensureUniqueSlug(dto.slug?.trim() || dto.title);
    const status = dto.status || 'DRAFT';
    const excerpt =
      dto.excerpt?.trim() || stripHtml(cleanHtml).slice(0, 180);

    const article = this.articleRepository.create({
      title: dto.title.trim(),
      slug,
      excerpt,
      contentHtml: cleanHtml,
      coverImageUrl: dto.coverImageUrl?.trim() || null,
      category: (dto.category || 'TIPS_KOST').trim().toUpperCase(),
      tags: normalizeTags(dto.tags),
      city: (dto.city || '').trim(),
      metaTitle: (dto.metaTitle || dto.title).trim().slice(0, 220),
      metaDescription: (dto.metaDescription || excerpt).trim().slice(0, 400),
      status,
      isFeatured: Boolean(dto.isFeatured),
      readingTimeMinutes: computeReadingTimeMinutes(cleanHtml),
      authorId,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    });

    const saved = await this.articleRepository.save(article);
    const full = await this.articleRepository.findOne({
      where: { id: saved.id },
      relations: ['author'],
    });
    return this.serializeArticle(full || saved);
  }

  async update(
    id: number,
    requesterId: number,
    dto: UpdateArticleDto,
    requesterRole?: string,
  ) {
    const article = await this.articleRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!article) {
      throw new NotFoundException('Artikel tidak ditemukan.');
    }
    const isAdmin = (requesterRole || '').toUpperCase() === 'ADMINISTRATOR';
    if (!isAdmin && article.authorId !== requesterId) {
      throw new ForbiddenException(
        'Anda hanya dapat mengubah artikel milik sendiri.',
      );
    }

    if (dto.title !== undefined) {
      article.title = dto.title.trim();
    }
    if (dto.slug !== undefined && dto.slug.trim()) {
      article.slug = await this.ensureUniqueSlug(dto.slug.trim(), article.id);
    }
    if (dto.contentHtml !== undefined) {
      const cleanHtml = sanitizeArticleHtml(dto.contentHtml);
      if (!stripHtml(cleanHtml)) {
        throw new BadRequestException('Konten artikel tidak boleh kosong.');
      }
      article.contentHtml = cleanHtml;
      article.readingTimeMinutes = computeReadingTimeMinutes(cleanHtml);
    }
    if (dto.excerpt !== undefined) {
      article.excerpt = dto.excerpt.trim();
    }
    if (dto.coverImageUrl !== undefined) {
      article.coverImageUrl = dto.coverImageUrl?.trim() || null;
    }
    if (dto.category !== undefined) {
      article.category = dto.category.trim().toUpperCase();
    }
    if (dto.tags !== undefined) {
      article.tags = normalizeTags(dto.tags);
    }
    if (dto.city !== undefined) {
      article.city = dto.city.trim();
    }
    if (dto.metaTitle !== undefined) {
      article.metaTitle = dto.metaTitle.trim().slice(0, 220);
    }
    if (dto.metaDescription !== undefined) {
      article.metaDescription = dto.metaDescription.trim().slice(0, 400);
    }
    if (dto.isFeatured !== undefined) {
      article.isFeatured = Boolean(dto.isFeatured);
    }
    if (dto.status !== undefined) {
      article.status = dto.status;
      if (dto.status === 'PUBLISHED' && !article.publishedAt) {
        article.publishedAt = new Date();
      }
    }

    const saved = await this.articleRepository.save(article);
    return this.serializeArticle(saved);
  }

  async remove(id: number, requesterId: number, requesterRole?: string) {
    const article = await this.articleRepository.findOne({ where: { id } });
    if (!article) {
      throw new NotFoundException('Artikel tidak ditemukan.');
    }
    const isAdmin = (requesterRole || '').toUpperCase() === 'ADMINISTRATOR';
    if (!isAdmin && article.authorId !== requesterId) {
      throw new ForbiddenException(
        'Anda hanya dapat menghapus artikel milik sendiri.',
      );
    }
    if (article.coverImageUrl) {
      void this.storageService.deleteByUrl(article.coverImageUrl);
    }
    await this.articleRepository.delete(id);
    return { deleted: true, id };
  }

  async uploadBase64Image(rawBase64: string) {
    const trimmed = rawBase64?.trim();
    if (!trimmed) {
      throw new BadRequestException('Data gambar base64 wajib diisi.');
    }
    const base64Data = trimmed.includes(',')
      ? trimmed.split(',').pop() || ''
      : trimmed;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException(
        'Ukuran gambar tidak valid (maksimal 8 MB).',
      );
    }

    const optimized = await sharp(buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const uploaded = await this.storageService.uploadBuffer(
      optimized,
      'articles',
      'webp',
      'image/webp',
    );
    return {
      url: uploaded.url,
      path: uploaded.key,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  async findAllCategories() {
    return this.categoryRepository.find({ order: { name: 'ASC' } });
  }

  async createCategory(dto: CreateArticleCategoryDto) {
    const name = dto.name.trim();
    const rawSlug = (dto.slug?.trim() || name)
      .toUpperCase()
      .replace(/[^A-Z0-9\s_-]/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);

    if (!rawSlug) {
      throw new BadRequestException('Slug kategori tidak valid.');
    }

    const exists = await this.categoryRepository.findOne({
      where: { slug: rawSlug },
    });
    if (exists) {
      throw new BadRequestException('Kategori dengan slug tersebut sudah ada.');
    }

    const cat = this.categoryRepository.create({
      name,
      slug: rawSlug,
      description: (dto.description || '').trim(),
    });
    return this.categoryRepository.save(cat);
  }

  async updateCategory(id: number, dto: UpdateArticleCategoryDto) {
    const cat = await this.categoryRepository.findOne({ where: { id } });
    if (!cat) {
      throw new NotFoundException('Kategori tidak ditemukan.');
    }
    if (dto.name !== undefined) {
      cat.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      cat.description = dto.description.trim();
    }
    if (dto.slug !== undefined && dto.slug.trim()) {
      const nextSlug = dto.slug
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9\s_-]/g, '')
        .replace(/[\s-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
      if (nextSlug && nextSlug !== cat.slug) {
        const exists = await this.categoryRepository.findOne({
          where: { slug: nextSlug, id: Not(id) },
        });
        if (exists) {
          throw new BadRequestException('Slug kategori sudah digunakan.');
        }
        cat.slug = nextSlug;
      }
    }
    return this.categoryRepository.save(cat);
  }

  async removeCategory(id: number) {
    const cat = await this.categoryRepository.findOne({ where: { id } });
    if (!cat) {
      throw new NotFoundException('Kategori tidak ditemukan.');
    }
    const usedCount = await this.articleRepository.count({
      where: { category: cat.slug },
    });
    if (usedCount > 0) {
      throw new BadRequestException(
        `Kategori masih digunakan oleh ${usedCount} artikel.`,
      );
    }
    await this.categoryRepository.delete(id);
    return { deleted: true, id };
  }
}
