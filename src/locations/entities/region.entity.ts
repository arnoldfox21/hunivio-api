import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('regions')
export class Region {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 120 })
  name: string;

  @Column({ length: 24, default: 'KOTA' })
  type: string; // 'KOTA' | 'KABUPATEN'

  @Column({ length: 100, default: '' })
  province: string;

  @Column('simple-json')
  districts: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
