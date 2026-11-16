import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('point_transactions')
export class PointTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ type: 'int', nullable: true })
  bookingId: number | null;

  @Column({ type: 'int' })
  points: number;

  @Column({ type: 'varchar', length: 24, default: 'EARN' })
  type: string; // 'EARN' | 'REDEEM' | 'REFUND'

  @Column({ type: 'text', default: '' })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
