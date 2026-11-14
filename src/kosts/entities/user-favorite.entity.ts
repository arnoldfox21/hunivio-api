import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('user_favorites')
@Unique(['userId', 'kostId'])
export class UserFavorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  userId: number;

  @Index()
  @Column({ type: 'int' })
  kostId: number;

  @CreateDateColumn()
  createdAt: Date;
}
