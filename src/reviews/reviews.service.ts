import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { KostsService } from '../kosts/kosts.service';
import { FirebaseNotificationService } from '../chats/firebase-notification.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly kostsService: KostsService,
    private readonly firebaseNotificationService: FirebaseNotificationService,
    private readonly usersService: UsersService,
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

    try {
      const kost = await this.kostsService.findOne(payload.kostId);
      if (kost.ownerId && kost.ownerId !== payload.userId) {
        const token = await this.usersService.getFcmToken(kost.ownerId);
        if (token) {
          await this.firebaseNotificationService.sendGeneralNotification({
            token,
            title: `Ulasan Baru • ${kost.name}`,
            body: `${saved.userName} memberi rating ${saved.overallRating}★: "${saved.comment}"`,
            data: {
              type: 'review',
              kostId: String(kost.id),
              receiverId: String(kost.ownerId),
            },
          });
        }
      }
    } catch {
      // Abaikan jika push gagal
    }

    return saved;
  }

  async replyToReview(
    reviewId: number,
    requesterId: number,
    requesterRole: string,
    reply: string,
  ): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan.');
    }

    const kost = await this.kostsService.findOne(review.kostId);
    const role = (requesterRole || '').toUpperCase();
    if (
      kost.ownerId !== requesterId &&
      role !== 'STAFF' &&
      role !== 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Hanya pemilik properti ini yang dapat membalas ulasan.',
      );
    }

    const trimmed = (reply || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Balasan ulasan tidak boleh kosong.');
    }

    review.ownerReply = trimmed;
    review.ownerReplyAt = new Date();
    const saved = await this.reviewRepository.save(review);

    try {
      if (review.userId && review.userId !== requesterId) {
        const token = await this.usersService.getFcmToken(review.userId);
        if (token) {
          await this.firebaseNotificationService.sendGeneralNotification({
            token,
            title: `Balasan Pemilik • ${kost.name}`,
            body: trimmed,
            data: {
              type: 'review_reply',
              kostId: String(kost.id),
              receiverId: String(review.userId),
            },
          });
        }
      }
    } catch {
      // Abaikan jika push gagal
    }

    return saved;
  }
}
