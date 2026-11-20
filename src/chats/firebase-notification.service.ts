import { Injectable, Logger, Optional } from '@nestjs/common';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FirebaseNotificationService {
  private readonly logger = new Logger(FirebaseNotificationService.name);
  private initialized = false;

  constructor(
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {
    this.initFirebase();
  }

  private initFirebase() {
    if (getApps().length > 0) {
      this.initialized = true;
      return;
    }

    const credPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      path.join(process.cwd(), 'firebase-service-account.json');

    if (!fs.existsSync(credPath)) {
      this.logger.warn(
        `Firebase service account tidak ditemukan di ${credPath}. Push notification FCM dinonaktifkan.`,
      );
      return;
    }

    try {
      const raw = fs.readFileSync(credPath, 'utf8');
      const serviceAccount = JSON.parse(raw);
      initializeApp({
        credential: cert(serviceAccount),
      });
      this.initialized = true;
      this.logger.log('Firebase Admin SDK berhasil diinisialisasi.');
    } catch (err) {
      this.logger.error('Gagal inisialisasi Firebase Admin SDK', err);
    }
  }

  private _collectTargetTokens(token?: string, tokens?: string[]): string[] {
    const set = new Set<string>();
    if (Array.isArray(tokens)) {
      for (const t of tokens) {
        const trimmed = (t || '').trim();
        if (trimmed) set.add(trimmed);
      }
    }
    const single = (token || '').trim();
    if (single) set.add(single);
    return Array.from(set);
  }

  async sendChatNotification(params: {
    token?: string;
    tokens?: string[];
    title: string;
    body: string;
    kostId: number;
    senderId: number;
    receiverId: number;
    senderName: string;
    messageId: number;
  }): Promise<void> {
    const targetTokens = this._collectTargetTokens(params.token, params.tokens);
    if (!this.initialized || targetTokens.length === 0) return;

    const results = await Promise.allSettled(
      targetTokens.map((token) =>
        getMessaging().send({
          token,
          notification: {
            title: params.title,
            body: params.body,
          },
          data: {
            type: 'chat',
            kostId: String(params.kostId),
            senderId: String(params.senderId),
            receiverId: String(params.receiverId),
            senderName: params.senderName,
            messageId: String(params.messageId),
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'keyloka_chat_channel',
              sound: 'default',
              defaultSound: true,
              visibility: 'public',
              priority: 'high',
            },
          },
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(
          `Gagal mengirim push notification FCM: ${(r.reason as Error)?.message || r.reason}`,
        );
      }
    }
  }

  async sendGeneralNotification(params: {
    token?: string;
    tokens?: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
    userId?: number;
    notifType?: string;
    targetUrl?: string;
  }): Promise<void> {
    if (params.userId && this.notificationsService) {
      await this.notificationsService
        .create({
          userId: params.userId,
          type: params.notifType || 'SYSTEM',
          title: params.title,
          body: params.body,
          targetUrl: params.targetUrl ?? null,
        })
        .catch(() => undefined);
    }

    const targetTokens = this._collectTargetTokens(params.token, params.tokens);
    if (!this.initialized || targetTokens.length === 0) return;

    const results = await Promise.allSettled(
      targetTokens.map((token) =>
        getMessaging().send({
          token,
          notification: {
            title: params.title,
            body: params.body,
          },
          data: {
            type: 'general',
            ...(params.data || {}),
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'keyloka_chat_channel',
              sound: 'default',
              defaultSound: true,
              visibility: 'public',
              priority: 'high',
            },
          },
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(
          `Gagal mengirim notifikasi umum FCM: ${(r.reason as Error)?.message || r.reason}`,
        );
      }
    }
  }
}
