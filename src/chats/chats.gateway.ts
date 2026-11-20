import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { UsersService } from '../users/users.service';
import { FirebaseNotificationService } from './firebase-notification.service';
import { verifyAuthToken } from '../auth/jwt.util';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.trim()
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : '*',
  },
})
export class ChatsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatsService: ChatsService,
    private readonly usersService: UsersService,
    private readonly firebaseNotificationService: FirebaseNotificationService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authToken =
        typeof client.handshake.auth?.token === 'string'
          ? client.handshake.auth.token
          : '';
      const headerAuth =
        typeof client.handshake.headers?.authorization === 'string'
          ? client.handshake.headers.authorization
          : '';
      const rawToken =
        authToken ||
        (headerAuth.startsWith('Bearer ') ? headerAuth.slice(7).trim() : '');
      const payload = rawToken ? verifyAuthToken(rawToken) : null;
      if (!payload) {
        client.disconnect(true);
        return;
      }
      const user = await this.usersService.findOne(payload.userId);
      if (user.isBanned) {
        client.disconnect(true);
        return;
      }
      client.data.userId = user.id;
      client.data.role = (user.role || 'PENYEWA').toUpperCase();
    } catch {
      client.disconnect(true);
    }
  }

  private _getSocketUserId(client: Socket): number | null {
    const uid = Number(client.data?.userId);
    return Number.isFinite(uid) && uid > 0 ? uid : null;
  }

  @SubscribeMessage('joinUserRoom')
  async handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() _payload: { userId?: number },
  ) {
    const userId = this._getSocketUserId(client);
    if (!userId) return { joined: false };

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
    const userId = this._getSocketUserId(client);
    if (!userId || !payload?.kostId) return { joined: false };
    client.join(`kost_${payload.kostId}`);
    client.join(`user_${userId}`);
    await this.emitMarkAsRead(payload.kostId, userId);
    return { joined: true, room: `kost_${payload.kostId}` };
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
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kostId: number; readerId?: number },
  ) {
    const readerId = this._getSocketUserId(client);
    if (!payload?.kostId || !readerId) {
      return { updated: false };
    }
    return this.emitMarkAsRead(payload.kostId, readerId);
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
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      kostId: number;
      senderId?: number;
      senderName: string;
      senderAvatar?: string;
      receiverId: number;
      message: string;
    },
  ) {
    const senderId = this._getSocketUserId(client);
    if (!senderId) return null;
    const saved = await this.chatsService.createMessage({
      ...payload,
      senderId,
    });
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
    const inboxPayload = {
      kostId: saved.kostId,
      senderId: saved.senderId,
      receiverId: saved.receiverId,
      lastMessage: latest.message,
      status: latest.status,
      createdAt: latest.createdAt,
    };
    this.server.to(`user_${saved.senderId}`).emit('inboxUpdated', inboxPayload);
    this.server.to(`user_${saved.receiverId}`).emit('inboxUpdated', inboxPayload);

    // Kirim FCM push notification ke semua device penerima
    try {
      const fcmTokens = await this.usersService.getFcmTokens(saved.receiverId);
      if (fcmTokens.length > 0) {
        await this.firebaseNotificationService.sendChatNotification({
          tokens: fcmTokens,
          title: latest.senderName || 'Pesan Baru di Keyloka',
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
    @MessageBody() payload: { kostId: number; userId?: number },
  ) {
    const userId = this._getSocketUserId(client);
    if (!payload?.kostId || !userId) return { joined: false };
    try {
      await this.chatsService.verifyGroupAccess(payload.kostId, userId);
      client.join(`kost_group_${payload.kostId}`);
      client.join(`user_${userId}`);
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
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      kostId: number;
      senderId?: number;
      senderName: string;
      senderAvatar?: string;
      message: string;
    },
  ) {
    const senderId = this._getSocketUserId(client);
    if (!senderId) return null;
    const saved = await this.chatsService.createGroupMessage({
      ...payload,
      senderId,
    });
    this.server.to(`kost_group_${payload.kostId}`).emit('newGroupMessage', saved);
    this.server.to(`kost_group_${payload.kostId}`).emit('inboxUpdated', {
      kostId: payload.kostId,
      isGroup: true,
      lastMessage: saved.message,
      createdAt: saved.createdAt,
    });

    // Kirim notifikasi ke semua anggota aktif grup (kecuali pengirim)
    try {
      const members = await this.chatsService.getGroupMembers(payload.kostId);
      for (const m of members) {
        if (m.userId === senderId) continue;
        this.server.to(`user_${m.userId}`).emit('newGroupNotification', {
          kostId: payload.kostId,
          senderId,
          senderName: saved.senderName,
          message: saved.message,
          messageId: saved.id,
        });
        const tokens = await this.usersService.getFcmTokens(m.userId);
        if (tokens.length > 0) {
          await this.firebaseNotificationService.sendChatNotification({
            tokens,
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
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      kostId: number;
      userId?: number;
      adminOnly?: boolean;
      pinnedMessageId?: number | null;
    },
  ) {
    const userId = this._getSocketUserId(client);
    if (!userId) return null;
    const updated = await this.chatsService.updateGroupSettings(
      payload.kostId,
      userId,
      payload,
    );
    this.server
      .to(`kost_group_${payload.kostId}`)
      .emit('groupSettingsUpdated', updated);
    return updated;
  }

  @SubscribeMessage('deleteGroupMessage')
  async handleDeleteGroupMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { kostId: number; userId?: number; messageId: number },
  ) {
    const userId = this._getSocketUserId(client);
    if (!userId) return null;
    const res = await this.chatsService.deleteGroupMessage(
      payload.kostId,
      userId,
      payload.messageId,
    );
    this.server
      .to(`kost_group_${payload.kostId}`)
      .emit('groupMessageDeleted', res);
    return res;
  }
}
