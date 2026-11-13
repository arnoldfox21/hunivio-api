import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kost } from './kosts/entities/kost.entity';
import { Booking } from './bookings/entities/booking.entity';
import { User } from './users/entities/user.entity';
import { KostsModule } from './kosts/kosts.module';
import { BookingsModule } from './bookings/bookings.module';
import { UsersModule } from './users/users.module';

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
            entities: [Kost, Booking, User],
            synchronize: true,
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'kost2u_db',
            entities: [Kost, Booking, User],
            synchronize: true,
          },
    ),
    KostsModule,
    BookingsModule,
    UsersModule,
  ],
})
export class AppModule {}
