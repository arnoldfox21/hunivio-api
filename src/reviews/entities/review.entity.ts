import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

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

  @CreateDateColumn()
  createdAt: Date;
}
