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

  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column()
  name: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: '' })
  phone: string;

  @Column({ default: false })
  showWhatsapp: boolean;

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

  @Column({ type: 'jsonb', default: [] })
  roles: string[];

  @Column({ default: false })
  isVerified: boolean;

  @Column({ type: 'varchar', length: 24, default: 'NONE' })
  verificationStatus: string; // 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED'

  @Column({ type: 'varchar', length: 64, default: '' })
  verificationSurveyDate: string;

  @Column({ type: 'int', nullable: true })
  verificationKostId: number | null;

  @Column({ type: 'text', default: '' })
  verificationNotes: string;

  @Column({ type: 'text', default: '' })
  verificationRejectionReason: string;

  @Column({ default: false })
  isBanned: boolean;

  @Column({ type: 'timestamp', nullable: true })
  bannedAt: Date | null;

  @Column({ default: true })
  onboardingCompleted: boolean;

  @Column({ type: 'varchar', length: 64, default: '' })
  preferredCategory: string;

  @Column({ type: 'text', default: '' })
  fcmToken: string;

  @Column({ type: 'jsonb', default: [] })
  fcmTokens: string[];

  @Column({ type: 'int', default: 0 })
  creditBalance: number;

  @Column({ type: 'int', default: 0 })
  payoutBalance: number;

  @Column({ type: 'int', default: 0 })
  pointsBalance: number;

  @Column({ type: 'int', default: 0 })
  totalPointsEarned: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
