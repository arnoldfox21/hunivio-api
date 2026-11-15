import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('review_reports')
export class ReviewReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  reviewId: number;

  @Column({ type: 'int' })
  kostId: number;

  @Column({ type: 'int' })
  reporterId: number;

  @Column()
  reporterName: string;

  @Column({ type: 'varchar', length: 120 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ default: 'OPEN' })
  status: string; // 'OPEN' | 'DISMISSED'

  @CreateDateColumn()
  createdAt: Date;
}
