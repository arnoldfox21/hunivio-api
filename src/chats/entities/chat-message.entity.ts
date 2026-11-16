import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  kostId: number;

  @Index()
  @Column({ type: 'int' })
  senderId: number;

  @Column()
  senderName: string;

  @Column({ default: '' })
  senderAvatar: string;

  @Index()
  @Column({ type: 'int' })
  receiverId: number;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: 'SENT' })
  status: string; // 'SENT' | 'DELIVERED' | 'READ'

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
