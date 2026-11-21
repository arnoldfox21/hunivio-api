import * as crypto from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { Kost } from './kosts/entities/kost.entity';
import { KostReport } from './kosts/entities/kost-report.entity';
import { KostDailyStat } from './kosts/entities/kost-daily-stat.entity';
import { Facility } from './kosts/entities/facility.entity';
import { UserFavorite } from './kosts/entities/user-favorite.entity';
import { Booking } from './bookings/entities/booking.entity';
import { PointTransaction } from './bookings/entities/point-transaction.entity';
import { User } from './users/entities/user.entity';
import { ChatMessage } from './chats/entities/chat-message.entity';
import { KostGroupMessage } from './chats/entities/kost-group-message.entity';
import { KostGroupSetting } from './chats/entities/kost-group-setting.entity';
import { Review } from './reviews/entities/review.entity';
import { ReviewReport } from './reviews/entities/review-report.entity';
import { OwnerPost } from './posts/entities/owner-post.entity';
import { OwnerPostComment } from './posts/entities/owner-post-comment.entity';
import { OwnerPostLike } from './posts/entities/owner-post-like.entity';
import { Region } from './locations/entities/region.entity';
import { WalletTransaction } from './wallet/entities/wallet-transaction.entity';
import { PayoutRequest } from './wallet/entities/payout-request.entity';
import { Notification } from './notifications/entities/notification.entity';
import { Article } from './articles/entities/article.entity';
import { ArticleCategory } from './articles/entities/article-category.entity';
import { PlatformSetting } from './platform/entities/platform-setting.entity';
import { PlatformEventLog } from './platform/entities/platform-event-log.entity';
import { KostsModule } from './kosts/kosts.module';
import { BookingsModule } from './bookings/bookings.module';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PostsModule } from './posts/posts.module';
import { LocationsModule } from './locations/locations.module';
import { WalletModule } from './wallet/wallet.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ArticlesModule } from './articles/articles.module';
import { MailModule } from './mail/mail.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        genReqId: (req) => {
          const existing = req.headers['x-request-id'];
          return (
            (Array.isArray(existing) ? existing[0] : existing) ||
            crypto.randomUUID()
          );
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.passwordHash',
            '*.token',
            '*.accessToken',
            '*.idToken',
          ],
          censor: '[REDACTED]',
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        autoLogging: {
          ignore: (req) =>
            req.url === '/api/locations/cities' &&
            !req.headers['x-forwarded-for'],
        },
        serializers: {
          req: (req: {
            id?: unknown;
            method?: string;
            url?: string;
            headers?: Record<string, unknown>;
            remoteAddress?: string;
          }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            ip:
              req.headers?.['x-client-ip'] ||
              req.headers?.['cf-connecting-ip'] ||
              req.headers?.['x-forwarded-for'] ||
              req.remoteAddress,
            ua: req.headers?.['user-agent'],
          }),
          res: (res: { statusCode?: number }) => ({
            statusCode: res.statusCode,
          }),
        },
        customProps: (req) => {
          const user = (req as { user?: { userId?: number; role?: string } })
            .user;
          return user?.userId
            ? { userId: user.userId, userRole: user.role }
            : {};
        },
        ...(process.env.NODE_ENV !== 'production'
          ? {
              transport: {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true },
              },
            }
          : {}),
      },
    }),
    TypeOrmModule.forRoot(
      process.env.DATABASE_URL
        ? {
            type: 'postgres',
            url: process.env.DATABASE_URL,
            ssl:
              process.env.DB_SSL === 'true' ||
              (process.env.DB_SSL !== 'false' &&
                (process.env.DATABASE_URL.includes('sslmode=require') ||
                  process.env.DATABASE_URL.includes('sslmode=verify-full') ||
                  process.env.DATABASE_URL.includes('ssl=true')))
                ? { rejectUnauthorized: false }
                : false,
            entities: [
              Kost,
              KostReport,
              KostDailyStat,
              Facility,
              UserFavorite,
              Booking,
              PointTransaction,
              User,
              ChatMessage,
              KostGroupMessage,
              KostGroupSetting,
              Review,
              ReviewReport,
              OwnerPost,
              OwnerPostComment,
              OwnerPostLike,
              Region,
              WalletTransaction,
              PayoutRequest,
              Notification,
              Article,
              ArticleCategory,
              PlatformSetting,
              PlatformEventLog,
            ],
            synchronize:
              process.env.DB_SYNCHRONIZE === 'true' ||
              process.env.NODE_ENV !== 'production',
            extra: {
              max: Math.max(5, Number(process.env.DB_POOL_MAX) || 20),
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000,
            },
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'kost2u_db',
            entities: [
              Kost,
              KostReport,
              KostDailyStat,
              Facility,
              UserFavorite,
              Booking,
              PointTransaction,
              User,
              ChatMessage,
              KostGroupMessage,
              KostGroupSetting,
              Review,
              ReviewReport,
              OwnerPost,
              OwnerPostComment,
              OwnerPostLike,
              Region,
              WalletTransaction,
              PayoutRequest,
              Notification,
              Article,
              ArticleCategory,
              PlatformSetting,
              PlatformEventLog,
            ],
            synchronize:
              process.env.DB_SYNCHRONIZE === 'true' ||
              process.env.NODE_ENV !== 'production',
            extra: {
              max: Math.max(5, Number(process.env.DB_POOL_MAX) || 20),
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000,
            },
          },
    ),
    KostsModule,
    BookingsModule,
    UsersModule,
    ChatsModule,
    ReviewsModule,
    PostsModule,
    LocationsModule,
    WalletModule,
    StorageModule,
    NotificationsModule,
    ArticlesModule,
    MailModule,
    PlatformModule,
  ],
})
export class AppModule {}
