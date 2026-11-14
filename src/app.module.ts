import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kost } from './kosts/entities/kost.entity';
import { Facility } from './kosts/entities/facility.entity';
import { Booking } from './bookings/entities/booking.entity';
import { User } from './users/entities/user.entity';
import { ChatMessage } from './chats/entities/chat-message.entity';
import { KostGroupMessage } from './chats/entities/kost-group-message.entity';
import { KostGroupSetting } from './chats/entities/kost-group-setting.entity';
import { Review } from './reviews/entities/review.entity';
import { OwnerPost } from './posts/entities/owner-post.entity';
import { Region } from './locations/entities/region.entity';
import { KostsModule } from './kosts/kosts.module';
import { BookingsModule } from './bookings/bookings.module';
import { UsersModule } from './users/users.module';
import { ChatsModule } from './chats/chats.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PostsModule } from './posts/posts.module';
import { LocationsModule } from './locations/locations.module';

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
            ssl: { rejectUnauthorized: false },
            entities: [
              Kost,
              Facility,
              Booking,
              User,
              ChatMessage,
              KostGroupMessage,
              KostGroupSetting,
              Review,
              OwnerPost,
              Region,
            ],
            synchronize: true,
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
              Facility,
              Booking,
              User,
              ChatMessage,
              KostGroupMessage,
              KostGroupSetting,
              Review,
              OwnerPost,
              Region,
            ],
            synchronize: true,
          },
    ),
    KostsModule,
    BookingsModule,
    UsersModule,
    ChatsModule,
    ReviewsModule,
    PostsModule,
    LocationsModule,
  ],
})
export class AppModule {}
