import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { KostsModule } from '../kosts/kosts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking]), KostsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
