import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('kost_reports')
export class KostReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  kostId: number;

  @Column({ type: 'int', nullable: true })
  reporterId: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reporterName: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reporterEmail: string | null;

  @Column({ type: 'varchar', length: 120 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ default: 'OPEN' })
  status: string; // 'OPEN' | 'DISMISSED'

  @CreateDateColumn()
  createdAt: Date;
}
