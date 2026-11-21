import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatMessage } from './entities/chat-message.entity';
import { KostGroupMessage } from './entities/kost-group-message.entity';
import { KostGroupSetting } from './entities/kost-group-setting.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { User } from '../users/entities/user.entity';
import { Booking } from '../bookings/entities/booking.entity';

export interface ChatBookingSummary {
  id: number;
  status: string;
  bookingType: string;
  startDate: string;
  surveyDateTime?: string | null;
  tenantName: string;
  ownerId: number;
}

@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatRepository: Repository<ChatMessage>,
    @InjectRepository(KostGroupMessage)
    private readonly groupMsgRepository: Repository<KostGroupMessage>,
    @InjectRepository(KostGroupSetting)
    private readonly groupSettingRepository: Repository<KostGroupSetting>,
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {}

  private isKostCategory(propertyCategory?: string | null): boolean {
    return (propertyCategory || 'KOST').trim().toUpperCase() === 'KOST';
  }

  private async attachBookingSummaries(
    messages: ChatMessage[],
  ): Promise<Array<ChatMessage & { booking?: ChatBookingSummary | null }>> {
    const bookingIds = Array.from(
      new Set(
        messages
          .map((m) => m.bookingId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    );
    if (bookingIds.length === 0) {
      return messages;
    }

    const bookings = await this.bookingRepository.find({
      where: { id: In(bookingIds) },
    });
    const kostIds = Array.from(new Set(bookings.map((b) => b.kostId)));
    const kosts =
      kostIds.length > 0
        ? await this.kostRepository.find({ where: { id: In(kostIds) } })
        : [];
    const ownerMap = new Map(kosts.map((k) => [k.id, k.ownerId]));
    const bookingMap = new Map<number, ChatBookingSummary>();
    for (const b of bookings) {
      bookingMap.set(b.id, {
        id: b.id,
        status: b.status,
        bookingType: b.bookingType,
        startDate: b.startDate,
        surveyDateTime: b.surveyDateTime ?? null,
        tenantName: b.tenantName,
        ownerId: ownerMap.get(b.kostId) ?? 0,
      });
    }

    return messages.map((m) =>
      m.bookingId
        ? Object.assign(m, { booking: bookingMap.get(m.bookingId) ?? null })
        : m,
    );
  }

  async findMessages(
    kostId: number,
    userId?: number,
    peerId?: number,
  ): Promise<Array<ChatMessage & { booking?: ChatBookingSummary | null }>> {
    if (!userId || userId <= 0) {
      return [];
    }
    const qb = this.chatRepository
      .createQueryBuilder('msg')
      .where('msg.kostId = :kostId', { kostId });

    if (peerId && peerId > 0 && peerId !== userId) {
      qb.andWhere(
        '((msg.senderId = :userId AND msg.receiverId = :peerId) OR (msg.senderId = :peerId AND msg.receiverId = :userId))',
        { userId, peerId },
      );
    } else {
      qb.andWhere('(msg.senderId = :userId OR msg.receiverId = :userId)', {
        userId,
      });
    }

    const messages = await qb
      .orderBy('msg.createdAt', 'ASC')
      .addOrderBy('msg.id', 'ASC')
      .getMany();
    return this.attachBookingSummaries(messages);
  }

  async createMessage(payload: {
    kostId: number;
    senderId: number;
    senderName: string;
    senderAvatar?: string;
    receiverId: number;
    message: string;
    bookingId?: number | null;
  }): Promise<ChatMessage & { booking?: ChatBookingSummary | null }> {
    const text = payload.message?.trim();
    if (!text) {
      throw new BadRequestException('Pesan tidak boleh kosong');
    }
    if (payload.senderId > 0 && payload.senderId === payload.receiverId) {
      throw new BadRequestException(
        'Anda tidak dapat mengirim pesan ke properti milik sendiri',
      );
    }
    let resolvedName = payload.senderName || 'Pengguna';
    let resolvedAvatar = payload.senderAvatar || '';
    if (payload.senderId > 0) {
      const sender = await this.userRepository.findOne({
        where: { id: payload.senderId },
      });
      if (sender?.name?.trim()) resolvedName = sender.name.trim();
      if (sender?.avatarUrl?.trim()) resolvedAvatar = sender.avatarUrl.trim();
    }
    const msg = this.chatRepository.create({
      kostId: payload.kostId,
      senderId: payload.senderId,
      senderName: resolvedName,
      senderAvatar: resolvedAvatar,
      receiverId: payload.receiverId || 1,
      message: text,
      bookingId: payload.bookingId ?? null,
      status: 'SENT',
    });
    const saved = await this.chatRepository.save(msg);
    if (saved.bookingId) {
      const [enriched] = await this.attachBookingSummaries([saved]);
      return enriched;
    }
    return saved;
  }

  async markMessageDelivered(messageId: number): Promise<ChatMessage | null> {
    const msg = await this.chatRepository.findOne({ where: { id: messageId } });
    if (!msg) return null;
    if (msg.status === 'SENT') {
      msg.status = 'DELIVERED';
      msg.deliveredAt = new Date();
      return this.chatRepository.save(msg);
    }
    return msg;
  }

  async markUserPendingDelivered(userId: number): Promise<
    Array<{ kostId: number; senderId: number; messageIds: number[] }>
  > {
    const pending = await this.chatRepository.find({
      where: { receiverId: userId, status: 'SENT' },
    });
    if (pending.length === 0) return [];

    const now = new Date();
    const groups = new Map<
      string,
      { kostId: number; senderId: number; messageIds: number[] }
    >();

    for (const m of pending) {
      m.status = 'DELIVERED';
      m.deliveredAt = now;
      const key = `${m.kostId}_${m.senderId}`;
      const existing = groups.get(key) ?? {
        kostId: m.kostId,
        senderId: m.senderId,
        messageIds: [],
      };
      existing.messageIds.push(m.id);
      groups.set(key, existing);
    }

    await this.chatRepository.save(pending);
    return Array.from(groups.values());
  }

  async markAsRead(
    kostId: number,
    readerId: number,
    senderId?: number,
  ): Promise<{ messageIds: number[]; senderIds: number[] }> {
    const qb = this.chatRepository
      .createQueryBuilder('msg')
      .where('msg.kostId = :kostId', { kostId })
      .andWhere('msg.receiverId = :readerId', { readerId })
      .andWhere('msg.status != :readStatus', { readStatus: 'READ' });

    if (senderId && senderId > 0) {
      qb.andWhere('msg.senderId = :senderId', { senderId });
    }

    const unread = await qb.getMany();

    if (unread.length === 0) {
      return { messageIds: [], senderIds: [] };
    }

    const now = new Date();
    const senderSet = new Set<number>();
    const messageIds: number[] = [];

    for (const m of unread) {
      if (!m.deliveredAt) m.deliveredAt = now;
      m.readAt = now;
      m.status = 'READ';
      messageIds.push(m.id);
      senderSet.add(m.senderId);
    }

    await this.chatRepository.save(unread);
    return { messageIds, senderIds: Array.from(senderSet) };
  }

  async getConversations(userId: number) {
    const messages = await this.chatRepository
      .createQueryBuilder('msg')
      .where('msg.senderId = :userId OR msg.receiverId = :userId', { userId })
      .orderBy('msg.createdAt', 'DESC')
      .addOrderBy('msg.id', 'DESC')
      .getMany();

    const seenKosts = new Map<
      number,
      ChatMessage & { unreadCount: number }
    >();
    const unreadCounts = new Map<number, number>();

    for (const m of messages) {
      if (m.receiverId === userId && m.status !== 'READ') {
        unreadCounts.set(m.kostId, (unreadCounts.get(m.kostId) ?? 0) + 1);
      }
      if (!seenKosts.has(m.kostId)) {
        seenKosts.set(m.kostId, Object.assign(m, { unreadCount: 0 }));
      }
    }

    const convKostIds = Array.from(seenKosts.keys());
    const kosts =
      convKostIds.length > 0
        ? await this.kostRepository.find({ where: { id: In(convKostIds) } })
        : [];
    const kostMap = new Map(kosts.map((k) => [k.id, k]));

    return Array.from(seenKosts.values()).map((conv) => ({
      ...conv,
      unreadCount: unreadCounts.get(conv.kostId) ?? 0,
      kost: kostMap.get(conv.kostId) || null,
    }));
  }

  private async getOrCreateGroupSetting(
    kostId: number,
  ): Promise<KostGroupSetting> {
    let setting = await this.groupSettingRepository.findOne({
      where: { kostId },
    });
    if (!setting) {
      setting = this.groupSettingRepository.create({
        kostId,
        pinnedMessageId: null,
        pinnedText: null,
        adminOnly: false,
        removedUserIds: [],
      });
      setting = await this.groupSettingRepository.save(setting);
    }
    return setting;
  }

  async verifyGroupAccess(
    kostId: number,
    userId: number,
  ): Promise<{
    kost: Kost;
    role: 'ADMIN' | 'MEMBER';
    setting: KostGroupSetting;
  }> {
    if (!userId || userId <= 0) {
      throw new ForbiddenException('Silakan login untuk mengakses grup penghuni');
    }
    const kost = await this.kostRepository.findOne({ where: { id: kostId } });
    if (!kost) {
      throw new NotFoundException('Properti tidak ditemukan');
    }
    if (!this.isKostCategory(kost.propertyCategory)) {
      throw new ForbiddenException(
        'Fitur Grup Penghuni hanya tersedia untuk properti Kost.',
      );
    }
    const setting = await this.getOrCreateGroupSetting(kostId);

    if (kost.ownerId === userId) {
      return { kost, role: 'ADMIN', setting };
    }

    const removed = (setting.removedUserIds || []).filter((id) => id !== '');
    if (removed.includes(String(userId))) {
      throw new ForbiddenException(
        'Anda telah dikeluarkan dari grup penghuni oleh Admin.',
      );
    }

    const added = (setting.addedUserIds || []).filter((id) => id !== '');
    if (added.includes(String(userId))) {
      return { kost, role: 'MEMBER', setting };
    }

    throw new ForbiddenException(
      'Hanya anggota grup yang ditambahkan pemilik properti yang dapat mengakses grup ini.',
    );
  }

  async getGroupMembers(kostId: number): Promise<
    Array<{
      userId: number;
      name: string;
      avatarUrl: string;
      role: 'ADMIN' | 'MEMBER';
    }>
  > {
    const kost = await this.kostRepository.findOne({ where: { id: kostId } });
    if (!kost) return [];
    const setting = await this.getOrCreateGroupSetting(kostId);
    const removedSet = new Set(
      (setting.removedUserIds || []).filter((id) => id !== ''),
    );

    const memberIds = new Set<number>([kost.ownerId]);
    for (const rawId of setting.addedUserIds || []) {
      const uid = parseInt(rawId, 10);
      if (!isNaN(uid) && uid > 0 && !removedSet.has(String(uid))) {
        memberIds.add(uid);
      }
    }

    const users = await this.userRepository.find({
      where: { id: In(Array.from(memberIds)) },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const members: Array<{
      userId: number;
      name: string;
      avatarUrl: string;
      role: 'ADMIN' | 'MEMBER';
    }> = [];

    const ownerUser = userMap.get(kost.ownerId);
    members.push({
      userId: kost.ownerId,
      name: ownerUser?.name || kost.ownerName || 'Pemilik Kost',
      avatarUrl: ownerUser?.avatarUrl || '',
      role: 'ADMIN',
    });

    for (const uid of memberIds) {
      if (uid === kost.ownerId) continue;
      const u = userMap.get(uid);
      members.push({
        userId: uid,
        name: u?.name || 'Penghuni',
        avatarUrl: u?.avatarUrl || '',
        role: 'MEMBER',
      });
    }

    return members;
  }

  async getGroupRoomsForUser(userId: number) {
    if (!userId || userId <= 0) return [];

    const ownedKosts = await this.kostRepository.find({
      where: { ownerId: userId },
      order: { id: 'ASC' },
    });

    const kostIds = new Set<number>(ownedKosts.map((k) => k.id));
    const uidStr = String(userId);
    const matchingSettings = await this.groupSettingRepository
      .createQueryBuilder('setting')
      .where(':uid = ANY(string_to_array(setting.addedUserIds, \',\'))', {
        uid: uidStr,
      })
      .getMany();
    for (const s of matchingSettings) {
      const removed = (s.removedUserIds || []).filter((x) => x !== '');
      if (!removed.includes(uidStr)) {
        kostIds.add(s.kostId);
      }
    }

    if (kostIds.size === 0) return [];

    const kostIdList = Array.from(kostIds);
    const [allKosts, settingsList, latestGroupMsgs] = await Promise.all([
      this.kostRepository.find({ where: { id: In(kostIdList) } }),
      this.groupSettingRepository.find({ where: { kostId: In(kostIdList) } }),
      this.groupMsgRepository
        .createQueryBuilder('msg')
        .where('msg.kostId IN (:...ids) AND msg.isDeleted = false', {
          ids: kostIdList,
        })
        .orderBy('msg.kostId', 'ASC')
        .addOrderBy('msg.createdAt', 'DESC')
        .addOrderBy('msg.id', 'DESC')
        .distinctOn(['msg.kostId'])
        .getMany(),
    ]);

    const settingMap = new Map(settingsList.map((s) => [s.kostId, s]));
    const lastMsgMap = new Map(latestGroupMsgs.map((m) => [m.kostId, m]));

    const rooms: Array<Record<string, any>> = [];
    for (const kost of allKosts) {
      if (!this.isKostCategory(kost.propertyCategory)) {
        continue;
      }
      const setting = settingMap.get(kost.id);
      const isAdmin = kost.ownerId === userId;
      const removed = (setting?.removedUserIds || []).filter((x) => x !== '');
      const removedSet = new Set(removed);
      if (!isAdmin && removedSet.has(String(userId))) {
        continue;
      }

      const memberIds = new Set<number>([kost.ownerId]);
      for (const rawId of setting?.addedUserIds || []) {
        const uid = parseInt(rawId, 10);
        if (!isNaN(uid) && uid > 0 && !removedSet.has(String(uid))) {
          memberIds.add(uid);
        }
      }

      const lastMsg = lastMsgMap.get(kost.id);

      // Tampilkan grup milik owner hanya jika sudah ada penghuni aktif atau sudah ada pesan grup
      if (isAdmin && memberIds.size <= 1 && !lastMsg) {
        continue;
      }

      rooms.push({
        kostId: kost.id,
        kostName: kost.name,
        kostImage: kost.images?.[0] || '',
        city: kost.city,
        district: kost.district,
        isAdmin,
        adminOnly: setting?.adminOnly ?? false,
        memberCount: memberIds.size,
        lastMessage: lastMsg?.message || 'Grup penghuni siap digunakan',
        lastSenderName: lastMsg?.senderName || '',
        lastMessageAt: lastMsg?.createdAt || kost.updatedAt,
      });
    }

    rooms.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );
    return rooms;
  }

  async getGroupDetail(kostId: number, userId: number) {
    if (!userId || userId <= 0) {
      throw new ForbiddenException('Silakan login untuk mengakses grup penghuni');
    }
    const kost = await this.kostRepository.findOne({ where: { id: kostId } });
    if (!kost) {
      throw new NotFoundException('Properti tidak ditemukan');
    }
    if (!this.isKostCategory(kost.propertyCategory)) {
      throw new ForbiddenException(
        'Fitur Grup Penghuni hanya tersedia untuk properti Kost.',
      );
    }

    const setting = await this.getOrCreateGroupSetting(kostId);
    const removed = (setting.removedUserIds || []).filter((id) => id !== '');
    const added = (setting.addedUserIds || []).filter((id) => id !== '');

    let myRole: 'ADMIN' | 'MEMBER' | 'NONE' = 'NONE';
    let isMember = false;
    if (kost.ownerId === userId) {
      myRole = 'ADMIN';
      isMember = true;
    } else if (!removed.includes(String(userId)) && added.includes(String(userId))) {
      myRole = 'MEMBER';
      isMember = true;
    }

    const members = await this.getGroupMembers(kostId);
    const messages = isMember
      ? await this.groupMsgRepository.find({
          where: { kostId, isDeleted: false },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];

    return {
      kostId,
      kostName: kost.name,
      kostImage: kost.images?.[0] || '',
      ownerId: kost.ownerId,
      myRole,
      isMember,
      settings: {
        pinnedMessageId: isMember ? setting.pinnedMessageId : null,
        pinnedText: isMember ? setting.pinnedText : null,
        adminOnly: setting.adminOnly,
      },
      members: isMember ? members : [],
      memberCount: members.length,
      messages,
    };
  }

  async createGroupMessage(payload: {
    kostId: number;
    senderId: number;
    senderName: string;
    senderAvatar?: string;
    message: string;
  }): Promise<KostGroupMessage> {
    const text = payload.message?.trim();
    if (!text) {
      throw new BadRequestException('Pesan tidak boleh kosong');
    }
    const access = await this.verifyGroupAccess(payload.kostId, payload.senderId);
    if (access.setting.adminOnly && access.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Mode Hanya Admin aktif. Hanya pemilik kost yang dapat mengirim pesan saat ini.',
      );
    }

    const msg = this.groupMsgRepository.create({
      kostId: payload.kostId,
      senderId: payload.senderId,
      senderName: payload.senderName || 'Pengguna',
      senderAvatar: payload.senderAvatar || '',
      senderRole: access.role,
      message: text,
      isDeleted: false,
    });
    return this.groupMsgRepository.save(msg);
  }

  async updateGroupSettings(
    kostId: number,
    userId: number,
    body: { adminOnly?: boolean; pinnedMessageId?: number | null },
  ) {
    const access = await this.verifyGroupAccess(kostId, userId);
    if (access.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Hanya Admin (pemilik properti) yang dapat mengubah pengaturan grup.',
      );
    }

    if (body.adminOnly !== undefined) {
      access.setting.adminOnly = body.adminOnly;
    }

    if (body.pinnedMessageId !== undefined) {
      if (body.pinnedMessageId === null) {
        access.setting.pinnedMessageId = null;
        access.setting.pinnedText = null;
      } else {
        const msg = await this.groupMsgRepository.findOne({
          where: { id: body.pinnedMessageId, kostId, isDeleted: false },
        });
        if (!msg) {
          throw new NotFoundException('Pesan tidak ditemukan');
        }
        access.setting.pinnedMessageId = msg.id;
        access.setting.pinnedText = `${msg.senderName}: ${msg.message}`;
      }
    }

    const saved = await this.groupSettingRepository.save(access.setting);
    return {
      kostId,
      pinnedMessageId: saved.pinnedMessageId,
      pinnedText: saved.pinnedText,
      adminOnly: saved.adminOnly,
    };
  }

  async deleteGroupMessage(
    kostId: number,
    userId: number,
    messageId: number,
  ): Promise<{ deleted: boolean; messageId: number }> {
    const access = await this.verifyGroupAccess(kostId, userId);
    const msg = await this.groupMsgRepository.findOne({
      where: { id: messageId, kostId },
    });
    if (!msg) {
      throw new NotFoundException('Pesan tidak ditemukan');
    }
    if (access.role !== 'ADMIN' && msg.senderId !== userId) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin menghapus pesan ini.',
      );
    }
    msg.isDeleted = true;
    await this.groupMsgRepository.save(msg);

    if (access.setting.pinnedMessageId === messageId) {
      access.setting.pinnedMessageId = null;
      access.setting.pinnedText = null;
      await this.groupSettingRepository.save(access.setting);
    }

    return { deleted: true, messageId };
  }

  async kickGroupMember(
    kostId: number,
    adminId: number,
    targetUserId: number,
  ): Promise<{ kicked: boolean; targetUserId: number }> {
    const access = await this.verifyGroupAccess(kostId, adminId);
    if (access.role !== 'ADMIN') {
      throw new ForbiddenException('Hanya Admin yang dapat mengeluarkan anggota');
    }
    if (targetUserId === access.kost.ownerId) {
      throw new BadRequestException('Admin tidak dapat dikeluarkan');
    }
    const existing = new Set(
      (access.setting.removedUserIds || []).filter((x) => x !== ''),
    );
    existing.add(String(targetUserId));
    access.setting.removedUserIds = Array.from(existing);
    access.setting.addedUserIds = (access.setting.addedUserIds || []).filter(
      (x) => x !== '' && x !== String(targetUserId),
    );
    await this.groupSettingRepository.save(access.setting);
    return { kicked: true, targetUserId };
  }

  async addGroupMember(
    kostId: number,
    adminId: number,
    targetUserId: number,
  ) {
    const access = await this.verifyGroupAccess(kostId, adminId);
    if (access.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Hanya Admin/pemilik properti yang dapat menambahkan anggota',
      );
    }
    if (targetUserId === access.kost.ownerId) {
      throw new BadRequestException('Pemilik sudah menjadi Admin grup');
    }
    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException('Pengguna tidak ditemukan');
    }

    access.setting.removedUserIds = (access.setting.removedUserIds || []).filter(
      (x) => x !== '' && x !== String(targetUserId),
    );
    const addedSet = new Set(
      (access.setting.addedUserIds || []).filter((x) => x !== ''),
    );
    addedSet.add(String(targetUserId));
    access.setting.addedUserIds = Array.from(addedSet);
    await this.groupSettingRepository.save(access.setting);

    return {
      added: true,
      targetUserId,
      members: await this.getGroupMembers(kostId),
    };
  }

  async searchGroupCandidates(
    kostId: number,
    adminId: number,
    query?: string,
  ) {
    const access = await this.verifyGroupAccess(kostId, adminId);
    if (access.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Hanya Admin/pemilik properti yang dapat mencari anggota',
      );
    }
    const members = await this.getGroupMembers(kostId);
    const memberIdSet = new Set(members.map((m) => m.userId));

    const qb = this.userRepository
      .createQueryBuilder('user')
      .orderBy('user.name', 'ASC')
      .take(30);

    const q = (query || '').trim().toLowerCase();
    if (q) {
      qb.where(
        'LOWER(user.name) LIKE :q OR LOWER(user.email) LIKE :q OR LOWER(user.phone) LIKE :q',
        { q: `%${q}%` },
      );
    }

    const users = await qb.getMany();
    return users
      .filter((u) => u.id !== access.kost.ownerId)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        avatarUrl: u.avatarUrl,
        isMember: memberIdSet.has(u.id),
      }));
  }
}
