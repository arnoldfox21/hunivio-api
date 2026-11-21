import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('platform_event_logs')
export class PlatformEventLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'INFO' })
  level: string; // 'INFO' | 'WARN' | 'ERROR'

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'SYSTEM' })
  category: string; // 'CONFIG' | 'BOOKING' | 'WALLET' | 'MAIL' | 'AUTH' | 'SYSTEM'

  @Column({ type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
