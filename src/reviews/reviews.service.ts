import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './entities/review.entity';
import { ReviewReport } from './entities/review-report.entity';
import { KostsService } from '../kosts/kosts.service';
import { FirebaseNotificationService } from '../chats/firebase-notification.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(ReviewReport)
    private readonly reviewReportRepository: Repository<ReviewReport>,
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

  private async getKostName(
    kostId: number,
    cache: Map<number, string>,
  ): Promise<string> {
    const cached = cache.get(kostId);
    if (cached !== undefined) return cached;
    let kostName: string;
    try {
      const kost = await this.kostsService.findOne(kostId);
      kostName = kost.name;
    } catch {
      kostName = `Properti #${kostId}`;
    }
    cache.set(kostId, kostName);
    return kostName;
  }

  private async recalculateKostRating(kostId: number): Promise<void> {
    const approvedReviews = await this.findByKost(kostId);
    const avg = approvedReviews.length
      ? approvedReviews.reduce((acc, r) => acc + r.overallRating, 0) /
        approvedReviews.length
      : 0;
    await this.kostsService.updateRating(
      kostId,
      Number(avg.toFixed(1)),
      approvedReviews.length,
    );
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

    const kost = await this.kostsService.findOne(payload.kostId);
    if (kost.ownerId === payload.userId) {
      throw new ForbiddenException(
        'Pemilik properti tidak dapat menulis ulasan pada propertinya sendiri.',
      );
    }

    const existing = await this.reviewRepository.findOne({
      where: { kostId: payload.kostId, userId: payload.userId },
    });
    if (existing) {
      throw new BadRequestException(
        'Anda sudah memberikan ulasan untuk properti ini.',
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
    await this.recalculateKostRating(payload.kostId);

    try {
      if (kost.ownerId && kost.ownerId !== saved.userId) {
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

  async reportReview(
    reviewId: number,
    reporterId: number,
    reason: string,
    details?: string,
  ): Promise<ReviewReport> {
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('Alasan laporan wajib diisi.');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan.');
    }
    if (review.userId === reporterId) {
      throw new BadRequestException(
        'Anda tidak dapat melaporkan ulasan Anda sendiri.',
      );
    }

    const existingOpen = await this.reviewReportRepository.findOne({
      where: { reviewId, reporterId, status: 'OPEN' },
    });
    if (existingOpen) {
      throw new BadRequestException('Anda sudah melaporkan ulasan ini.');
    }

    let reporterName = 'Pengguna';
    try {
      const user = await this.usersService.findOne(reporterId);
      if (user?.name?.trim()) {
        reporterName = user.name.trim();
      }
    } catch {
      // Gunakan nama default jika lookup gagal
    }

    const report = this.reviewReportRepository.create({
      reviewId,
      kostId: review.kostId,
      reporterId,
      reporterName,
      reason: trimmedReason,
      details: details?.trim() ? details.trim() : null,
      status: 'OPEN',
    });
    return this.reviewReportRepository.save(report);
  }

  async findOpenReports(): Promise<
    Array<
      ReviewReport & {
        kostName: string;
        reviewComment: string;
        reviewAuthorName: string;
        reviewOverallRating: number;
      }
    >
  > {
    const reports = await this.reviewReportRepository.find({
      where: { status: 'OPEN' },
      order: { createdAt: 'DESC' },
    });
    const kostNameCache = new Map<number, string>();
    const reviewCache = new Map<number, Review | null>();
    const result: Array<
      ReviewReport & {
        kostName: string;
        reviewComment: string;
        reviewAuthorName: string;
        reviewOverallRating: number;
      }
    > = [];

    for (const report of reports) {
      let review = reviewCache.get(report.reviewId);
      if (review === undefined) {
        review = await this.reviewRepository.findOne({
          where: { id: report.reviewId },
        });
        reviewCache.set(report.reviewId, review);
      }
      if (!review) {
        continue;
      }
      const kostName = await this.getKostName(report.kostId, kostNameCache);
      result.push(
        Object.assign(report, {
          kostName,
          reviewComment: review.comment,
          reviewAuthorName: review.userName,
          reviewOverallRating: review.overallRating,
        }),
      );
    }
    return result;
  }

  async dismissReport(reportId: number): Promise<ReviewReport> {
    const report = await this.reviewReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundException('Laporan ulasan tidak ditemukan.');
    }
    report.status = 'DISMISSED';
    return this.reviewReportRepository.save(report);
  }

  async deleteReview(reviewId: number): Promise<{ deleted: true }> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Ulasan tidak ditemukan.');
    }

    await this.reviewReportRepository.delete({ reviewId });
    await this.reviewRepository.delete({ id: reviewId });
    await this.recalculateKostRating(review.kostId);
    return { deleted: true };
  }
}
