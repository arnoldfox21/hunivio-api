import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { KostsModule } from '../kosts/kosts.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking]), KostsModule, ChatsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
