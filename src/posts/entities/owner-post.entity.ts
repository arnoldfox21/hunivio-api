import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('owner_posts')
export class OwnerPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ownerId: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  imageUrl: string | null;

  @Column({ type: 'int', nullable: true })
  kostId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
