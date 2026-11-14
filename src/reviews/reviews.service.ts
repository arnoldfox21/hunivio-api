import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { KostsService } from '../kosts/kosts.service';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly kostsService: KostsService,
  ) {}

  async findByKost(kostId: number): Promise<Review[]> {
    return this.reviewRepository.find({
      where: { kostId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(payload: {
    kostId: number;
    userId: number;
    userName: string;
    userAvatar?: string;
    ratingCleanliness: number;
    ratingSecurity: number;
    ratingAccuracy: number;
    comment: string;
  }): Promise<Review> {
    if (!payload.comment?.trim()) {
      throw new BadRequestException('Komentar ulasan wajib diisi');
    }

    const verifiedBooking = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.kostId = :kostId', { kostId: payload.kostId })
      .andWhere('b.userId = :userId', { userId: payload.userId })
      .andWhere('b.status IN (:...statuses)', {
        statuses: ['AKTIF', 'SELESAI', 'DISETUJUI'],
      })
      .getOne();

    if (!verifiedBooking) {
      throw new ForbiddenException(
        'Hanya penyewa dengan booking aktif/disetujui yang dapat menulis ulasan terverifikasi.',
      );
    }

    const overallRating = Number(
      (
        (payload.ratingCleanliness +
          payload.ratingSecurity +
          payload.ratingAccuracy) /
        3
      ).toFixed(1),
    );

    const review = this.reviewRepository.create({
      kostId: payload.kostId,
      userId: payload.userId,
      userName: payload.userName || 'Penghuni',
      userAvatar: payload.userAvatar || '',
      ratingCleanliness: payload.ratingCleanliness,
      ratingSecurity: payload.ratingSecurity,
      ratingAccuracy: payload.ratingAccuracy,
      overallRating,
      comment: payload.comment.trim(),
    });

    const saved = await this.reviewRepository.save(review);

    const allReviews = await this.findByKost(payload.kostId);
    const avg =
      allReviews.reduce((acc, r) => acc + r.overallRating, 0) /
      allReviews.length;
    await this.kostsService.updateRating(
      payload.kostId,
      Number(avg.toFixed(1)),
      allReviews.length,
    );

    return saved;
  }
}
