import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('payout_requests')
export class PayoutRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 64 })
  bankName: string;

  @Column({ type: 'varchar', length: 64 })
  accountNumber: string;

  @Column({ type: 'varchar', length: 128 })
  accountHolder: string;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'PENDING' })
  status: string; // 'PENDING' | 'APPROVED' | 'REJECTED'

  @Column({ type: 'text', default: '' })
  adminNote: string;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
