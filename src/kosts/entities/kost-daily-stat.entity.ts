import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
} from 'typeorm';

@Entity('kost_daily_stats')
@Unique(['kostId', 'date'])
export class KostDailyStat {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  kostId: number;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  date: string; // YYYY-MM-DD

  @Column({ type: 'int', default: 0 })
  views: number;

  @Column({ type: 'int', default: 0 })
  waClicks: number;
}
