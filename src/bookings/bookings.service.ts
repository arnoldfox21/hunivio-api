import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { KostsService } from '../kosts/kosts.service';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly kostsService: KostsService,
  ) {}

  async create(dto: CreateBookingDto): Promise<Booking> {
    const kost = await this.kostsService.findOne(dto.kostId);
    const totalPrice = kost.pricePerMonth * dto.durationMonths;

    const booking = this.bookingRepository.create({
      ...dto,
      totalPrice,
      status: 'MENUNGGU KONFIRMASI',
    });

    const saved = await this.bookingRepository.save(booking);
    await this.kostsService.decrementAvailableRoom(dto.kostId);
    return this.bookingRepository.findOneOrFail({ where: { id: saved.id } });
  }

  async findAll(): Promise<Booking[]> {
    return this.bookingRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
}
