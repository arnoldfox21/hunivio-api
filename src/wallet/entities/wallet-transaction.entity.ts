import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @Column({ unique: true })
  orderId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 24, default: 'TOPUP' })
  type: string;

  @Column({ type: 'varchar', length: 24, default: 'PENDING' })
  status: string;

  @Column({ name: 'snapToken', type: 'varchar', nullable: true })
  paymentReference: string | null;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'varchar', length: 64, default: '' })
  paymentMethod: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
