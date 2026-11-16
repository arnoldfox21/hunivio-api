import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Unique(['kostId', 'userId'])
@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  kostId: number;

  @Column({ type: 'int' })
  userId: number;

  @Column()
  userName: string;

  @Column({ default: '' })
  userAvatar: string;

  @Column({ type: 'float', default: 5 })
  ratingCleanliness: number;

  @Column({ type: 'float', default: 5 })
  ratingSecurity: number;

  @Column({ type: 'float', default: 5 })
  ratingAccuracy: number;

  @Column({ type: 'float', default: 5 })
  overallRating: number;

  @Column({ type: 'text' })
  comment: string;

  @Column({ type: 'text', nullable: true })
  ownerReply: string | null;

  @Column({ type: 'timestamp', nullable: true })
  ownerReplyAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
