import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kost } from './kosts/entities/kost.entity';
import { KostReport } from './kosts/entities/kost-report.entity';
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
import { KostsModule } from './kosts/kosts.module';
import { BookingsModule } from './bookings/bookings.module';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PostsModule } from './posts/posts.module';
import { LocationsModule } from './locations/locations.module';
import { WalletModule } from './wallet/wallet.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
            ],
            synchronize:
              process.env.DB_SYNCHRONIZE === 'true' ||
              process.env.NODE_ENV !== 'production',
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
            ],
            synchronize:
              process.env.DB_SYNCHRONIZE === 'true' ||
              process.env.NODE_ENV !== 'production',
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
  ],
})
export class AppModule {}
