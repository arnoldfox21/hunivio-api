import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('kost_group_messages')
export class KostGroupMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  kostId: number;

  @Column({ type: 'int' })
  senderId: number;

  @Column()
  senderName: string;

  @Column({ default: '' })
  senderAvatar: string;

  @Column({ default: 'MEMBER' })
  senderRole: string; // 'ADMIN' | 'MEMBER'

  @Column({ type: 'text' })
  message: string;

  @Column({ default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
