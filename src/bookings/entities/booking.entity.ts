import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Kost } from '../../kosts/entities/kost.entity';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

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

  @Column({ type: 'int', default: 1 })
  durationMonths: number;

  @Column({ type: 'int' })
  totalPrice: number;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ default: 'SEWA' })
  bookingType: string; // 'SEWA' | 'SURVEI'

  @Column({ default: '' })
  surveyDateTime: string;

  @Column({ default: 'QRIS' })
  paymentMethod: string;

  @Column({ default: 'BELUM_BAYAR' })
  paymentStatus: string; // 'BELUM_BAYAR' | 'MENUNGGU_PEMBAYARAN' | 'LUNAS'

  @Column({ default: '' })
  invoiceNumber: string;

  @Column({ default: 'MENUNGGU KONFIRMASI' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;
}
