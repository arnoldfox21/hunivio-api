import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('kost_group_settings')
export class KostGroupSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  kostId: number;

  @Column({ type: 'int', nullable: true })
  pinnedMessageId: number | null;

  @Column({ type: 'text', nullable: true })
  pinnedText: string | null;

  @Column({ default: false })
  adminOnly: boolean;

  @Column({ type: 'simple-array', default: '' })
  removedUserIds: string[];

  @Column({ type: 'simple-array', default: '' })
  addedUserIds: string[];

  @UpdateDateColumn()
  updatedAt: Date;
}
