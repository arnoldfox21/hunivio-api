import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type ArticleStatus = 'DRAFT' | 'PUBLISHED';

@Entity('articles')
export class Article {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 220, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 220 })
  title: string;

  @Column({ type: 'text', default: '' })
  excerpt: string;

  @Column({ type: 'text' })
  contentHtml: string;

  @Column({ type: 'text', nullable: true })
  coverImageUrl: string | null;

  @Index()
  @Column({ type: 'varchar', length: 80, default: 'TIPS_KOST' })
  category: string;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @Column({ type: 'varchar', length: 100, default: '' })
  city: string;

  @Column({ type: 'varchar', length: 220, default: '' })
  metaTitle: string;

  @Column({ type: 'text', default: '' })
  metaDescription: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: ArticleStatus;

  @Column({ type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: 'int', default: 1 })
  readingTimeMinutes: number;

  @Index()
  @Column({ type: 'int' })
  authorId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: User;

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
