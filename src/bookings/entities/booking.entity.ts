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

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ default: 'SURVEI' })
  bookingType: string;

  @Column({ default: '' })
  surveyDateTime: string;

  @Column({ default: 'TERKIRIM' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;
}
