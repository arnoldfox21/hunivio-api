import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  googleId: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: '' })
  phone: string;

  @Column({ default: '' })
  username: string;

  @Column({ type: 'text', default: '' })
  bio: string;

  @Column({ default: '' })
  city: string;

  @Column({ nullable: true })
  coverUrl: string;

  @Column({ default: 'PENYEWA' })
  role: string;

  @Column({ default: true })
  onboardingCompleted: boolean;

  @Column({ type: 'varchar', length: 64, default: '' })
  preferredCategory: string;

  @Column({ type: 'text', default: '' })
  fcmToken: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
