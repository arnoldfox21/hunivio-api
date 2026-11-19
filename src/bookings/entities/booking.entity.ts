import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Kost } from '../../kosts/entities/kost.entity';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  kostId: number;

  @ManyToOne(() => Kost, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'kostId' })
  kost: Kost;

  @Column()
  tenantName: string;

  @Column()
  tenantPhone: string;

  @Column()
  startDate: string;

  @Index()
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  ownerId: number | null;

  @Column({ default: 'SURVEI' })
  bookingType: string;

  @Column({ default: '' })
  surveyDateTime: string;

  @Index()
  @Column({ default: 'TERKIRIM' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'int', default: 1 })
  durationCount: number;

  @Column({ type: 'varchar', length: 16, default: 'MONTH' })
  durationUnit: string; // 'DAY' | 'MONTH'

  @Column({ type: 'int', default: 0 })
  totalAmount: number;

  @Column({ type: 'int', default: 0 })
  platformFee: number;

  @Column({ type: 'int', default: 0 })
  ownerNetAmount: number;

  @Column({ type: 'int', default: 0 })
  serviceFee: number;

  @Column({ type: 'varchar', length: 16, default: 'FULL' })
  paymentScheme: string; // 'FULL' | 'DP'

  @Column({ type: 'int', default: 0 })
  paidAmount: number;

  @Column({ type: 'int', default: 0 })
  remainingAmount: number;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  paymentOrderId: string | null;

  @Column({ name: 'snapToken', type: 'varchar', nullable: true })
  paymentReference: string | null;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'varchar', length: 24, default: 'UNPAID' })
  paymentStatus: string; // 'UNPAID' | 'PAID' | 'EXPIRED' | 'REFUNDED'

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'NONE' })
  escrowStatus: string; // 'NONE' | 'HELD' | 'RELEASED' | 'DISPUTED' | 'REFUNDED'

  @Column({ type: 'text', default: '' })
  disputeReason: string;

  @Column({ type: 'timestamp', nullable: true })
  checkedInAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  releasedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  pointsUsed: number;

  @Column({ type: 'int', default: 0 })
  pointsDiscountAmount: number;

  @Column({ type: 'int', default: 0 })
  pointsEarned: number;

  @CreateDateColumn()
  createdAt: Date;
}
