import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { UsersService } from '../users/users.service';
import { FirebaseNotificationService } from './firebase-notification.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatsGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatsService: ChatsService,
    private readonly usersService: UsersService,
    private readonly firebaseNotificationService: FirebaseNotificationService,
  ) {}

  @SubscribeMessage('joinUserRoom')
  async handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: number },
  ) {
    const userId = payload?.userId;
    if (!userId || userId <= 0) return { joined: false };

    client.join(`user_${userId}`);
    const deliveredGroups =
      await this.chatsService.markUserPendingDelivered(userId);

    for (const g of deliveredGroups) {
      const updateEvent = {
        kostId: g.kostId,
        readerId: userId,
        status: 'DELIVERED',
        messageIds: g.messageIds,
      };
      this.server.to(`kost_${g.kostId}`).emit('messageStatusUpdated', updateEvent);
      this.server.to(`user_${g.senderId}`).emit('messageStatusUpdated', updateEvent);
    }

    return { joined: true, room: `user_${userId}` };
  }

  @SubscribeMessage('joinKostChat')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kostId: number; userId?: number },
  ) {
    if (payload?.kostId) {
      client.join(`kost_${payload.kostId}`);
    }
    if (payload?.userId && payload.userId > 0) {
      client.join(`user_${payload.userId}`);
      if (payload?.kostId) {
        await this.emitMarkAsRead(payload.kostId, payload.userId);
      }
    }
    return { joined: true, room: `kost_${payload?.kostId}` };
  }

  @SubscribeMessage('leaveKostChat')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kostId: number },
  ) {
    if (payload?.kostId) {
      client.leave(`kost_${payload.kostId}`);
    }
    return { left: true };
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() payload: { kostId: number; readerId: number },
  ) {
    if (!payload?.kostId || !payload?.readerId) {
      return { updated: false };
    }
    return this.emitMarkAsRead(payload.kostId, payload.readerId);
  }

  async emitMarkAsRead(kostId: number, readerId: number) {
    const res = await this.chatsService.markAsRead(kostId, readerId);
    if (res.messageIds.length > 0) {
      const event = {
        kostId,
        readerId,
        status: 'READ',
        messageIds: res.messageIds,
      };
      this.server.to(`kost_${kostId}`).emit('messageStatusUpdated', event);
      for (const sid of res.senderIds) {
        this.server.to(`user_${sid}`).emit('messageStatusUpdated', event);
      }
    }
    return { updated: res.messageIds.length > 0, ...res };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    payload: {
      kostId: number;
      senderId: number;
      senderName: string;
      senderAvatar?: string;
      receiverId: number;
      message: string;
    },
  ) {
    const saved = await this.chatsService.createMessage(payload);
    return this.notifyNewChatMessage(saved);
  }

  // Cek apakah penerima sedang terhubung ke Socket.IO (room user_<receiverId>)
  async notifyNewChatMessage(saved: {
    id: number;
    kostId: number;
    senderId: number;
    senderName: string;
    receiverId: number;
    message: string;
    status: string;
    createdAt: Date;
  }) {
    let latest = saved;
    const receiverRoom = this.server.sockets.adapter.rooms.get(
      `user_${saved.receiverId}`,
    );
    const receiverOnline = !!receiverRoom && receiverRoom.size > 0;
    if (receiverOnline) {
      const updated = await this.chatsService.markMessageDelivered(saved.id);
      if (updated) latest = updated;
    }

    this.server.to(`kost_${saved.kostId}`).emit('newMessage', latest);
    this.server.to(`user_${saved.receiverId}`).emit('newMessage', latest);
    this.server.emit('inboxUpdated', {
      kostId: saved.kostId,
      senderId: saved.senderId,
      receiverId: saved.receiverId,
      lastMessage: latest.message,
      status: latest.status,
      createdAt: latest.createdAt,
    });

    // Kirim FCM push notification ke HP penerima
    try {
      const fcmToken = await this.usersService.getFcmToken(saved.receiverId);
      if (fcmToken) {
        await this.firebaseNotificationService.sendChatNotification({
          token: fcmToken,
          title: latest.senderName || 'Pesan Baru di HuniVio',
          body: latest.message,
          kostId: latest.kostId,
          senderId: latest.senderId,
          receiverId: latest.receiverId,
          senderName: latest.senderName,
          messageId: latest.id,
        });
      }
    } catch (_) {}

    return latest;
  }

  @SubscribeMessage('joinGroupChat')
  async handleJoinGroupChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kostId: number; userId: number },
  ) {
    if (!payload?.kostId || !payload?.userId) return { joined: false };
    try {
      await this.chatsService.verifyGroupAccess(payload.kostId, payload.userId);
      client.join(`kost_group_${payload.kostId}`);
      client.join(`user_${payload.userId}`);
      return { joined: true, room: `kost_group_${payload.kostId}` };
    } catch (_) {
      return { joined: false };
    }
  }

  @SubscribeMessage('leaveGroupChat')
  handleLeaveGroupChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kostId: number },
  ) {
    if (payload?.kostId) {
      client.leave(`kost_group_${payload.kostId}`);
    }
    return { left: true };
  }

  @SubscribeMessage('sendGroupMessage')
  async handleSendGroupMessage(
    @MessageBody()
    payload: {
      kostId: number;
      senderId: number;
      senderName: string;
      senderAvatar?: string;
      message: string;
    },
  ) {
    const saved = await this.chatsService.createGroupMessage(payload);
    this.server.to(`kost_group_${payload.kostId}`).emit('newGroupMessage', saved);
    this.server.emit('inboxUpdated', {
      kostId: payload.kostId,
      isGroup: true,
      lastMessage: saved.message,
      createdAt: saved.createdAt,
    });

    // Kirim notifikasi ke semua anggota aktif grup (kecuali pengirim)
    try {
      const members = await this.chatsService.getGroupMembers(payload.kostId);
      for (const m of members) {
        if (m.userId === payload.senderId) continue;
        this.server.to(`user_${m.userId}`).emit('newGroupNotification', {
          kostId: payload.kostId,
          senderId: payload.senderId,
          senderName: saved.senderName,
          message: saved.message,
          messageId: saved.id,
        });
        const token = await this.usersService.getFcmToken(m.userId);
        if (token) {
          await this.firebaseNotificationService.sendChatNotification({
            token,
            title: `Grup Penghuni • ${saved.senderName}`,
            body: saved.message,
            kostId: saved.kostId,
            senderId: saved.senderId,
            receiverId: m.userId,
            senderName: saved.senderName,
            messageId: saved.id,
          });
        }
      }
    } catch (_) {}

    return saved;
  }

  @SubscribeMessage('updateGroupSettings')
  async handleUpdateGroupSettings(
    @MessageBody()
    payload: {
      kostId: number;
      userId: number;
      adminOnly?: boolean;
      pinnedMessageId?: number | null;
    },
  ) {
    const updated = await this.chatsService.updateGroupSettings(
      payload.kostId,
      payload.userId,
      payload,
    );
    this.server
      .to(`kost_group_${payload.kostId}`)
      .emit('groupSettingsUpdated', updated);
    return updated;
  }

  @SubscribeMessage('deleteGroupMessage')
  async handleDeleteGroupMessage(
    @MessageBody()
    payload: { kostId: number; userId: number; messageId: number },
  ) {
    const res = await this.chatsService.deleteGroupMessage(
      payload.kostId,
      payload.userId,
      payload.messageId,
    );
    this.server
      .to(`kost_group_${payload.kostId}`)
      .emit('groupMessageDeleted', res);
    return res;
  }
}
