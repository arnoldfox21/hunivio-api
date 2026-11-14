import { Injectable, Logger } from '@nestjs/common';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseNotificationService {
  private readonly logger = new Logger(FirebaseNotificationService.name);
  private initialized = false;

  constructor() {
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

  async sendChatNotification(params: {
    token: string;
    title: string;
    body: string;
    kostId: number;
    senderId: number;
    receiverId: number;
    senderName: string;
    messageId: number;
  }): Promise<void> {
    if (!this.initialized || !params.token) return;

    try {
      await getMessaging().send({
        token: params.token,
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
            channelId: 'hunivio_chat_channel',
            sound: 'default',
            defaultSound: true,
            visibility: 'public',
            priority: 'high',
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Gagal mengirim push notification FCM: ${(err as Error)?.message || err}`,
      );
    }
  }

  async sendGeneralNotification(params: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    if (!this.initialized || !params.token) return;

    try {
      await getMessaging().send({
        token: params.token,
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
            channelId: 'hunivio_chat_channel',
            sound: 'default',
            defaultSound: true,
            visibility: 'public',
            priority: 'high',
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Gagal mengirim notifikasi umum FCM: ${(err as Error)?.message || err}`,
      );
    }
  }
}
