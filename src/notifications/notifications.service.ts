import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(params: {
    userId: number;
    type?: string;
    title: string;
    body: string;
    targetUrl?: string | null;
  }): Promise<Notification | null> {
    if (!params.userId || params.userId <= 0) return null;
    const entity = this.notificationRepository.create({
      userId: params.userId,
      type: (params.type || 'SYSTEM').toUpperCase(),
      title: params.title,
      body: params.body,
      targetUrl: params.targetUrl ?? null,
      isRead: false,
    });
    return this.notificationRepository.save(entity);
  }

  async findForUser(
    userId: number,
    opts?: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
      type?: string;
    },
  ): Promise<{
    data: Notification[];
    total: number;
    unreadCount: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, opts?.page || 1);
    const limit = Math.min(50, Math.max(1, opts?.limit || 20));
    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'DESC');

    if (opts?.unreadOnly) {
      qb.andWhere('n.isRead = false');
    }
    if (opts?.type && opts.type.toUpperCase() !== 'SEMUA') {
      qb.andWhere('n.type = :type', { type: opts.type.toUpperCase() });
    }

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });

    return {
      data,
      total,
      unreadCount,
      hasMore: page * limit < total,
    };
  }

  async getUnreadCount(userId: number): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async markAsRead(id: number, userId: number): Promise<Notification> {
    const item = await this.notificationRepository.findOne({
      where: { id, userId },
    });
    if (!item) {
      throw new NotFoundException('Notifikasi tidak ditemukan.');
    }
    if (!item.isRead) {
      item.isRead = true;
      await this.notificationRepository.save(item);
    }
    return item;
  }

  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const res = await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { updated: res.affected || 0 };
  }
}
