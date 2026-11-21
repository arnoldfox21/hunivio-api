import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Booking } from './entities/booking.entity';
import { PointTransaction } from './entities/point-transaction.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { User } from '../users/entities/user.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { KostsService } from '../kosts/kosts.service';
import { ChatsService } from '../chats/chats.service';
import { ChatsGateway } from '../chats/chats.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { PlatformService } from '../platform/platform.service';

export const BOOKING_PLATFORM_FEE_PERCENT = 1;
export const POINT_RUPIAH_VALUE = 50; // 1 poin = Rp50
export const RUPIAH_PER_POINT_EARNED = 10000; // Rp10.000 = 1 poin

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private _escrowTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(PointTransaction)
    private readonly pointTxRepository: Repository<PointTransaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(forwardRef(() => KostsService))
    private readonly kostsService: KostsService,
    private readonly chatsService: ChatsService,
    private readonly chatsGateway: ChatsGateway,
    private readonly dataSource: DataSource,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly platformService?: PlatformService,
  ) {}

  private _resolveScheduleLabel(
    startDate: string,
    surveyDateTime?: string,
    time?: string,
    defaultEmpty = false,
  ): string {
    const dt = (surveyDateTime || '').trim();
    if (dt) return dt;
    const cleanDate = (startDate || '').trim();
    const cleanTime = (time || '').trim();
    if (cleanDate && cleanTime) {
      return `${cleanDate} ${cleanTime} WIB`;
    }
    return defaultEmpty ? '' : cleanDate;
  }

  private async _createNotificationSafe(params: {
    userId?: number | null;
    type: string;
    title: string;
    body: string;
    targetUrl?: string | null;
  }): Promise<void> {
    if (!params.userId || params.userId <= 0 || !this.notificationsService) {
      return;
    }
    await this.notificationsService
      .create({
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        targetUrl: params.targetUrl ?? null,
      })
      .catch((err) => {
        this.logger.warn(
          `Gagal menyimpan notifikasi (userId=${params.userId}, type=${params.type}): ${err instanceof Error ? err.message : err}`,
        );
      });
  }

  onModuleInit() {
    this._escrowTimer = setInterval(() => {
      this.autoReleaseExpiredHeldEscrows().catch((err) => {
        this.logger.error(
          `Gagal menjalankan autoReleaseExpiredHeldEscrows: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, 6 * 60 * 60 * 1000);
    this._escrowTimer.unref();
  }

  onModuleDestroy() {
    if (this._escrowTimer) {
      clearInterval(this._escrowTimer);
      this._escrowTimer = null;
    }
  }

  async autoReleaseExpiredHeldEscrows(): Promise<number> {
    const heldBookings = await this.bookingRepository.find({
      where: {
        bookingType: 'SEWA',
        paymentStatus: 'PAID',
        escrowStatus: 'HELD',
      },
      take: 50,
    });
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let releasedCount = 0;

    for (const b of heldBookings) {
      const parsedStart = Date.parse(b.startDate);
      const isDue = Number.isFinite(parsedStart)
        ? now - parsedStart >= threeDaysMs
        : now - new Date(b.createdAt).getTime() >= sevenDaysMs;
      if (!isDue) continue;

      try {
        const releasedInfo = await this.dataSource.transaction(async (manager) => {
          const bookingRepo = manager.getRepository(Booking);
          const kostRepo = manager.getRepository(Kost);
          const userRepo = manager.getRepository(User);

          const locked = await bookingRepo.findOne({
            where: { id: b.id },
            lock: { mode: 'pessimistic_write' },
            loadEagerRelations: false,
          });
          if (!locked || locked.escrowStatus !== 'HELD') return null;

          const kost = await kostRepo.findOne({
            where: { id: locked.kostId },
          });
          if (kost) {
            const owner = await userRepo.findOne({
              where: { id: kost.ownerId },
              lock: { mode: 'pessimistic_write' },
            });
            if (owner) {
              owner.payoutBalance =
                Number(owner.payoutBalance ?? 0) +
                Number(locked.ownerNetAmount ?? 0);
              await userRepo.save(owner);
            }
          }

          locked.escrowStatus = 'RELEASED';
          locked.status = 'AKTIF';
          locked.checkedInAt = locked.checkedInAt || new Date();
          locked.releasedAt = new Date();
          locked.pointsEarned = await this._awardBookingPoints(
            manager,
            locked,
            kost?.name || 'Properti Keyloka',
          );
          await bookingRepo.save(locked);
          return {
            kostName: kost?.name || 'Properti Keyloka',
            ownerId: kost?.ownerId ?? locked.ownerId,
            userId: locked.userId,
            tenantName: locked.tenantName,
            ownerNetAmount: locked.ownerNetAmount,
            pointsEarned: locked.pointsEarned,
          };
        });
        if (releasedInfo) {
          releasedCount += 1;
          void this._createNotificationSafe({
            userId: releasedInfo.ownerId,
            type: 'ESCROW',
            title: `Dana Escrow Cair • ${releasedInfo.kostName}`,
            body: `Dana bersih Rp${Number(releasedInfo.ownerNetAmount ?? 0).toLocaleString('id-ID')} dari booking ${releasedInfo.tenantName} telah diteruskan otomatis ke saldo Anda.`,
            targetUrl: '/dashboard?tab=WALLET',
          });
          void this._createNotificationSafe({
            userId: releasedInfo.userId,
            type: 'BOOKING',
            title: `Booking Aktif • ${releasedInfo.kostName}`,
            body: `Masa sewa Anda telah aktif dan ${releasedInfo.pointsEarned} poin loyalti ditambahkan.`,
            targetUrl: '/bookings',
          });
        }
      } catch (err) {
        this.logger.warn(
          `Gagal auto-release escrow bookingId=${b.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return releasedCount;
  }

  async create(dto: CreateBookingDto): Promise<Booking> {
    const kost = await this.kostsService.findOne(dto.kostId);
    if ((kost.approvalStatus || 'APPROVED').toUpperCase() !== 'APPROVED') {
      throw new BadRequestException(
        'Properti ini belum disetujui dan belum dapat disewa.',
      );
    }
    if (dto.userId && dto.userId > 0 && kost.ownerId === dto.userId) {
      throw new BadRequestException(
        'Anda tidak dapat mengajukan survei pada properti milik sendiri.',
      );
    }
    if (kost.ownerId) {
      const owner = await this.userRepository.findOne({
        where: { id: kost.ownerId },
      });
      const ownerRole = (owner?.role || '').toUpperCase();
      if (ownerRole === 'STAFF' || ownerRole === 'ADMINISTRATOR') {
        throw new BadRequestException(
          'Properti ini dikurasi tim Keyloka dan belum diklaim pengelola. Silakan hubungi pengelola langsung melalui WhatsApp.',
        );
      }
    }
    const type = 'SURVEI';
    const isSurvey = true;

    // Cegah pengajuan ganda pada properti yang sama jika masih dalam proses / aktif
    const ongoingStatuses = [
      'TERKIRIM',
      'MENUNGGU KONFIRMASI',
      'DISETUJUI',
      'APPROVED',
      'AKTIF',
    ];
    const existingWhere: Record<string, any> = {
      kostId: dto.kostId,
      bookingType: type,
      status: In(ongoingStatuses),
    };
    if (dto.userId && dto.userId > 0) {
      existingWhere.userId = dto.userId;
    } else if (dto.tenantPhone) {
      existingWhere.tenantPhone = dto.tenantPhone.trim();
    }

    if (existingWhere.userId || existingWhere.tenantPhone) {
      const existing = await this.bookingRepository.findOne({
        where: existingWhere,
      });
      if (existing) {
        throw new BadRequestException(
          isSurvey
            ? 'Anda sudah memiliki jadwal survei yang masih dalam proses untuk properti ini.'
            : 'Anda sudah memiliki pengajuan sewa yang masih dalam proses atau aktif untuk properti ini.',
        );
      }
    }

    // Anti-spam survei: cegah loop Submit -> Cancel -> Submit pada kost yang sama & batasi kuota survei harian per user
    if (dto.userId && dto.userId > 0) {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [sameKost24hCount, totalActiveSurveys, total24hSurveys] =
        await Promise.all([
          this.bookingRepository
            .createQueryBuilder('b')
            .where('b.userId = :uid AND b.kostId = :kid AND b.bookingType = :t AND b.createdAt >= :since', {
              uid: dto.userId,
              kid: dto.kostId,
              t: type,
              since: since24h,
            })
            .getCount(),
          this.bookingRepository.count({
            where: {
              userId: dto.userId,
              bookingType: type,
              status: In(ongoingStatuses),
            },
          }),
          this.bookingRepository
            .createQueryBuilder('b')
            .where('b.userId = :uid AND b.bookingType = :t AND b.createdAt >= :since', {
              uid: dto.userId,
              t: type,
              since: since24h,
            })
            .getCount(),
        ]);

      const cfg = await this.platformService?.getSettings().catch(() => null);
      const maxActiveSurveys = Math.max(
        1,
        Number(cfg?.maxActiveSurveysPerUser ?? 5),
      );
      const maxDailySurveys = Math.max(
        1,
        Number(cfg?.maxDailySurveysPerUser ?? 8),
      );

      if (sameKost24hCount >= 3) {
        throw new BadRequestException(
          'Anda terlalu sering mengajukan atau membatalkan survei pada properti ini dalam 24 jam terakhir. Silakan coba lagi besok.',
        );
      }
      if (
        totalActiveSurveys >= maxActiveSurveys ||
        total24hSurveys >= maxDailySurveys
      ) {
        throw new BadRequestException(
          'Anda telah mencapai batas maksimal pengajuan survei aktif/harian. Selesaikan jadwal survei yang ada terlebih dahulu.',
        );
      }
    }

    const resolvedSchedule = this._resolveScheduleLabel(
      dto.startDate,
      dto.surveyDateTime,
      dto.surveyTime,
    );

    const booking = this.bookingRepository.create({
      ...dto,
      ownerId: kost.ownerId,
      bookingType: type,
      surveyDateTime: resolvedSchedule,
      status: 'TERKIRIM',
    });

    const saved = await this.bookingRepository.save(booking);

    // Kirim pesan chat masuk otomatis ke pemilik sebagai info pengajuan
    if (dto.userId && dto.userId > 0 && kost.ownerId !== dto.userId) {
      const notesLine = dto.notes?.trim()
        ? `\nCatatan: ${dto.notes.trim()}`
        : '';
      const autoMessage = `Halo, saya ${dto.tenantName} (${dto.tenantPhone}) mengajukan jadwal SURVEI untuk ${kost.name} pada ${resolvedSchedule}.${notesLine}`;
      try {
        const autoChat = await this.chatsService.createMessage({
          kostId: dto.kostId,
          senderId: dto.userId,
          senderName: dto.tenantName,
          receiverId: kost.ownerId,
          message: autoMessage,
          bookingId: saved.id,
        });
        await this.chatsGateway.notifyNewChatMessage(autoChat);
      } catch {
        // Jangan gagalkan penyimpanan pengajuan jika auto-chat gagal
      }

      await this._createNotificationSafe({
        userId: kost.ownerId,
        type: 'SURVEI',
        title: `Pengajuan Survei Baru • ${kost.name}`,
        body: `${dto.tenantName} mengajukan jadwal survei pada ${resolvedSchedule}.`,
        targetUrl: '/bookings',
      });

      void this.userRepository
        .findOne({ where: { id: kost.ownerId } })
        .then((owner) => {
          if (owner?.email) {
            return this.mailService?.sendEmail(owner.email, {
              subject: `[Keyloka] Pengajuan Survei Baru • ${kost.name}`,
              badgeText: 'Survei Baru',
              badgeTone: 'blue',
              title: 'Ada Pengajuan Survei Baru',
              greetingName: owner.name,
              intro:
                'Calon penyewa mengajukan jadwal survei / menanyakan ketersediaan kamar untuk properti Anda.',
              details: [
                { label: 'Properti', value: kost.name },
                { label: 'Calon Penyewa', value: dto.tenantName },
                {
                  label: 'Rencana Tanggal & Jam',
                  value: resolvedSchedule,
                },
                ...(dto.notes?.trim()
                  ? [{ label: 'Catatan', value: dto.notes.trim() }]
                  : []),
              ],
              ctaLabel: 'Tinjau di Dashboard',
              ctaUrl: '/bookings',
            });
          }
        })
        .catch(() => undefined);
    }

    return this.bookingRepository.findOneOrFail({ where: { id: saved.id } });
  }

  async findAll(query?: {
    userId?: number;
    ownerId?: number;
    all?: boolean;
    page?: number;
    limit?: number;
  }): Promise<Booking[]> {
    const hasUser = query?.userId && query.userId > 0;
    const hasOwner = query?.ownerId && query.ownerId > 0;
    if (!hasUser && !hasOwner && !query?.all) {
      return [];
    }

    const qb = this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.kost', 'kost')
      .orderBy('booking.createdAt', 'DESC');

    if (hasUser) {
      qb.andWhere('booking.userId = :userId', { userId: query!.userId });
    }
    if (hasOwner) {
      qb.andWhere('COALESCE(booking.ownerId, kost.ownerId) = :ownerId', {
        ownerId: query!.ownerId,
      });
    }

    const defaultLimit = query?.all ? 30 : 50;
    const limit = Math.min(100, Math.max(1, query?.limit || defaultLimit));
    const page = Math.max(1, query?.page || 1);
    qb.skip((page - 1) * limit).take(limit);

    const list = await qb.getMany();
    const kosts = list
      .map((b) => b.kost)
      .filter((k): k is NonNullable<typeof k> => Boolean(k));
    if (kosts.length > 0) {
      await this.kostsService.syncOwnerNames(kosts);
    }
    return list;
  }

  async updateStatus(
    id: number,
    status: string,
    requesterId?: number,
    requesterRole?: string,
  ): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
    }
    const kost = await this.kostsService.findOne(booking.kostId);
    const role = (requesterRole || '').toUpperCase();
    const bookingOwnerId = booking.ownerId || kost.ownerId;
    if (
      requesterId &&
      bookingOwnerId !== requesterId &&
      role !== 'STAFF' &&
      role !== 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin mengubah status pengajuan properti ini.',
      );
    }

    const ALLOWED_STATUSES = new Set([
      'TERKIRIM',
      'MENUNGGU KONFIRMASI',
      'DISETUJUI',
      'DITOLAK',
      'AKTIF',
      'SELESAI',
      'DIBATALKAN',
    ]);
    const prevStatus = (booking.status || '').toUpperCase();
    const nextStatus = status.trim().toUpperCase();
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      throw new BadRequestException('Status booking tidak valid.');
    }

    if (
      (booking.bookingType || '').toUpperCase() === 'SEWA' &&
      booking.paymentStatus !== 'PAID' &&
      (nextStatus === 'DISETUJUI' ||
        nextStatus === 'APPROVED' ||
        nextStatus === 'AKTIF')
    ) {
      throw new BadRequestException(
        'Booking langsung ini belum dibayar oleh penyewa.',
      );
    }
    if (
      (booking.bookingType || '').toUpperCase() === 'SEWA' &&
      booking.paymentStatus === 'PAID' &&
      booking.escrowStatus === 'HELD' &&
      nextStatus === 'AKTIF'
    ) {
      throw new BadRequestException(
        'Booking sewa langsung hanya menjadi AKTIF setelah penyewa konfirmasi check-in.',
      );
    }

    booking.status = nextStatus;
    const saved = await this.bookingRepository.save(booking);

    // Kembalikan kuota kamar (availableRooms + 1) saat masa sewa berbayar berakhir (SELESAI)
    const activeRentStatuses = new Set([
      'DIBAYAR',
      'DISETUJUI',
      'APPROVED',
      'AKTIF',
    ]);
    if (
      (booking.bookingType || '').toUpperCase() === 'SEWA' &&
      booking.paymentStatus === 'PAID' &&
      booking.escrowStatus !== 'REFUNDED' &&
      activeRentStatuses.has(prevStatus) &&
      nextStatus === 'SELESAI'
    ) {
      await this.dataSource
        .transaction(async (manager) => {
          const kostRepo = manager.getRepository(Kost);
          const lockedKost = await kostRepo.findOne({
            where: { id: booking.kostId },
            lock: { mode: 'pessimistic_write' },
          });
          if (lockedKost) {
            lockedKost.availableRooms = Math.max(
              0,
              Number(lockedKost.availableRooms ?? 0) + 1,
            );
            await kostRepo.save(lockedKost);
          }
        })
        .catch((err) => {
          this.logger.warn(
            `Gagal mengembalikan availableRooms untuk kostId=${booking.kostId}: ${err instanceof Error ? err.message : err}`,
          );
        });
    }

    if (
      prevStatus !== nextStatus &&
      booking.userId &&
      booking.userId > 0 &&
      kost.ownerId !== booking.userId
    ) {
      const jenis = booking.bookingType === 'SURVEI' ? 'survei' : 'sewa';
      const scheduleLabel = booking.surveyDateTime || booking.startDate;
      let notifText = '';
      if (nextStatus === 'DISETUJUI' || nextStatus === 'APPROVED') {
        notifText = `Pengajuan ${jenis} Anda untuk ${kost.name} (${scheduleLabel}) telah DISETUJUI oleh pemilik. Silakan koordinasi langkah selanjutnya melalui chat ini.`;
      } else if (nextStatus === 'DITOLAK') {
        notifText = `Maaf, pengajuan ${jenis} Anda untuk ${kost.name} (${scheduleLabel}) belum dapat disetujui pemilik.`;
      } else if (nextStatus === 'AKTIF') {
        notifText = `Status sewa Anda di ${kost.name} kini AKTIF. Selamat menempati properti!`;
      } else if (nextStatus === 'SELESAI') {
        notifText =
          booking.bookingType === 'SURVEI'
            ? `Jadwal survei Anda di ${kost.name} (${scheduleLabel}) telah ditandai SELESAI. Terima kasih telah menggunakan Keyloka.`
            : `Masa sewa Anda di ${kost.name} telah ditandai SELESAI. Terima kasih telah menggunakan Keyloka.`;
      }
      if (notifText) {
        try {
          const autoChat = await this.chatsService.createMessage({
            kostId: booking.kostId,
            senderId: kost.ownerId,
            senderName: kost.ownerName || 'Pemilik Properti',
            receiverId: booking.userId,
            message: notifText,
          });
          await this.chatsGateway.notifyNewChatMessage(autoChat);
        } catch {
          // Jangan gagalkan update status jika notifikasi gagal
        }

        await this.notificationsService
          ?.create({
            userId: booking.userId,
            type: booking.bookingType === 'SURVEI' ? 'SURVEI' : 'BOOKING',
            title: `Status ${jenis === 'survei' ? 'Survei' : 'Booking'} • ${kost.name}`,
            body: notifText,
            targetUrl: '/bookings',
          })
          .catch(() => undefined);

        if (
          nextStatus === 'DISETUJUI' ||
          nextStatus === 'APPROVED' ||
          nextStatus === 'DITOLAK'
        ) {
          const isApproved =
            nextStatus === 'DISETUJUI' || nextStatus === 'APPROVED';
          void this.userRepository
            .findOne({ where: { id: booking.userId } })
            .then((tenant) => {
              if (tenant?.email) {
                return this.mailService?.sendEmail(tenant.email, {
                  subject: `[Keyloka] Pengajuan ${jenis === 'survei' ? 'Survei' : 'Booking'} ${isApproved ? 'Disetujui' : 'Ditolak'} • ${kost.name}`,
                  badgeText: isApproved ? 'Disetujui' : 'Ditolak',
                  badgeTone: isApproved ? 'emerald' : 'red',
                  title: `Status ${jenis === 'survei' ? 'Survei' : 'Booking'} Diperbarui`,
                  greetingName: tenant.name,
                  intro: notifText,
                  details: [
                    { label: 'Properti', value: kost.name },
                    {
                      label: 'Tanggal',
                      value: booking.surveyDateTime || booking.startDate,
                    },
                  ],
                  ctaLabel: 'Lihat Detail Booking',
                  ctaUrl: '/bookings',
                });
              }
            })
            .catch(() => undefined);
        }
      }
    }

    return saved;
  }

  async cancelBooking(
    id: number,
    requesterId?: number,
    requesterRole?: string,
  ): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
    }
    const kost = await this.kostsService.findOne(booking.kostId);
    const role = (requesterRole || '').toUpperCase();
    if (requesterId && requesterId > 0) {
      const isTenant = booking.userId === requesterId;
      const isOwner = (booking.ownerId || kost.ownerId) === requesterId;
      const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
      if (!isTenant && !isOwner && !isStaff) {
        throw new ForbiddenException(
          'Anda tidak memiliki izin untuk membatalkan pengajuan ini.',
        );
      }
    }
    if (
      (booking.bookingType || '').toUpperCase() === 'SEWA' &&
      booking.paymentStatus === 'PAID' &&
      (booking.escrowStatus === 'HELD' ||
        booking.escrowStatus === 'DISPUTED' ||
        booking.escrowStatus === 'RELEASED')
    ) {
      throw new BadRequestException(
        'Booking yang sudah dibayar tidak dapat dibatalkan langsung. Gunakan fitur Laporkan Kendala agar Admin memproses refund.',
      );
    }

    const cancelled = await this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const locked = await bookingRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!locked) {
        throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
      }
      if (locked.status !== 'DIBATALKAN' && locked.pointsUsed > 0 && locked.userId) {
        await this._refundBookingPoints(manager, locked);
      }
      locked.status = 'DIBATALKAN';
      return bookingRepo.save(locked);
    });

    if (
      cancelled.userId &&
      cancelled.userId > 0 &&
      kost.ownerId !== cancelled.userId &&
      requesterId !== cancelled.userId
    ) {
      const jenis = cancelled.bookingType === 'SURVEI' ? 'survei' : 'sewa';
      const notifMsg = `Pengajuan ${jenis} Anda untuk ${kost.name} telah DIBATALKAN oleh pemilik.`;
      try {
        const autoChat = await this.chatsService.createMessage({
          kostId: cancelled.kostId,
          senderId: kost.ownerId,
          senderName: kost.ownerName || 'Pemilik Properti',
          receiverId: cancelled.userId,
          message: notifMsg,
        });
        await this.chatsGateway.notifyNewChatMessage(autoChat);
      } catch {
        // Jangan gagalkan pembatalan jika notifikasi chat gagal
      }
      await this._createNotificationSafe({
        userId: cancelled.userId,
        type: cancelled.bookingType === 'SURVEI' ? 'SURVEI' : 'BOOKING',
        title: `${cancelled.bookingType === 'SURVEI' ? 'Survei' : 'Booking'} Dibatalkan • ${kost.name}`,
        body: notifMsg,
        targetUrl: '/bookings',
      });
    } else if (
      kost.ownerId &&
      kost.ownerId > 0 &&
      requesterId === cancelled.userId &&
      kost.ownerId !== cancelled.userId
    ) {
      const jenis = cancelled.bookingType === 'SURVEI' ? 'survei' : 'booking';
      await this._createNotificationSafe({
        userId: kost.ownerId,
        type: cancelled.bookingType === 'SURVEI' ? 'SURVEI' : 'BOOKING',
        title: `${cancelled.bookingType === 'SURVEI' ? 'Survei' : 'Booking'} Dibatalkan Penyewa • ${kost.name}`,
        body: `${cancelled.tenantName} membatalkan pengajuan ${jenis} untuk ${kost.name}.`,
        targetUrl: '/bookings',
      });
    }

    return cancelled;
  }

  private get midtransConfig() {
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
    if (!serverKey) {
      throw new InternalServerErrorException(
        'Konfigurasi Midtrans Server Key belum tersedia.',
      );
    }
    return {
      serverKey,
      snapUrl: isProd
        ? 'https://app.midtrans.com/snap/v1/transactions'
        : 'https://app.sandbox.midtrans.com/snap/v1/transactions',
      statusBaseUrl: isProd
        ? 'https://api.midtrans.com/v2'
        : 'https://api.sandbox.midtrans.com/v2',
    };
  }

  private _basicAuthHeader(serverKey: string): string {
    return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;
  }

  async createDirectBooking(params: {
    userId: number;
    kostId: number;
    tenantName: string;
    tenantPhone: string;
    startDate: string;
    checkInTime?: string;
    surveyDateTime?: string;
    durationCount: number;
    notes?: string;
    usePoints?: boolean;
    paymentScheme?: 'FULL' | 'DP';
  }): Promise<Booking> {
    const cfg = await this.platformService?.getSettings().catch(() => null);
    if (cfg && cfg.allowDirectBookingGlobal === false) {
      throw new BadRequestException(
        'Fitur booking langsung sedang dinonaktifkan sementara oleh administrator.',
      );
    }

    const kost = await this.kostsService.findOne(params.kostId);
    if (kost.ownerId === params.userId) {
      throw new BadRequestException(
        'Pemilik properti tidak dapat melakukan booking pada propertinya sendiri.',
      );
    }
    if ((kost.approvalStatus || 'APPROVED').toUpperCase() !== 'APPROVED') {
      throw new BadRequestException(
        'Properti ini belum disetujui dan belum dapat di-booking.',
      );
    }
    if (!kost.allowDirectBooking) {
      throw new BadRequestException(
        'Properti ini belum mengaktifkan fitur booking langsung via aplikasi. Silakan ajukan survei lokasi.',
      );
    }
    if (kost.ownerId) {
      const owner = await this.userRepository.findOne({
        where: { id: kost.ownerId },
      });
      const ownerRole = (owner?.role || '').toUpperCase();
      if (ownerRole === 'STAFF' || ownerRole === 'ADMINISTRATOR') {
        throw new BadRequestException(
          'Properti ini belum diklaim oleh pemilik resmi untuk Booking Langsung. Silakan hubungi pengelola melalui WhatsApp.',
        );
      }
      if (!owner?.isVerified) {
        throw new BadRequestException(
          'Pemilik properti belum terverifikasi untuk Booking Langsung. Silakan ajukan survei lokasi.',
        );
      }
    }
    if (kost.availableRooms <= 0) {
      throw new BadRequestException(
        'Maaf, saat ini tidak ada kamar/unit yang tersedia.',
      );
    }

    const existingSameKostUnpaid = await this.bookingRepository.findOne({
      where: {
        userId: params.userId,
        kostId: params.kostId,
        bookingType: 'SEWA',
        paymentStatus: 'UNPAID',
        status: In(['MENUNGGU_PEMBAYARAN', 'TERKIRIM']),
      },
    });
    if (existingSameKostUnpaid) {
      throw new BadRequestException(
        'Anda masih memiliki booking yang menunggu pembayaran untuk properti ini. Silakan lanjutkan pembayaran atau batalkan di halaman Booking.',
      );
    }

    const unpaidCount = await this.bookingRepository.count({
      where: {
        userId: params.userId,
        bookingType: 'SEWA',
        paymentStatus: 'UNPAID',
        status: In(['MENUNGGU_PEMBAYARAN', 'TERKIRIM']),
      },
    });
    const maxUnpaidBookings = Math.max(
      1,
      Number(cfg?.maxUnpaidBookingsPerUser ?? 2),
    );
    if (unpaidCount >= maxUnpaidBookings) {
      throw new BadRequestException(
        `Anda memiliki ${unpaidCount} booking yang belum dibayar (maksimal ${maxUnpaidBookings}). Selesaikan atau batalkan terlebih dahulu.`,
      );
    }

    // Anti-spam invoice Midtrans: batasi pembuatan transaksi booking berulang (create -> cancel loop) dalam 1 jam terakhir
    const maxHourlyDirectBookings = Math.max(
      1,
      Number(cfg?.maxHourlyDirectBookingsPerUser ?? 5),
    );
    const since1h = new Date(Date.now() - 60 * 60 * 1000);
    const recentDirectCount = await this.bookingRepository
      .createQueryBuilder('b')
      .where(
        'b.userId = :uid AND b.bookingType = :t AND b.createdAt >= :since',
        {
          uid: params.userId,
          t: 'SEWA',
          since: since1h,
        },
      )
      .getCount();
    if (recentDirectCount >= maxHourlyDirectBookings) {
      throw new BadRequestException(
        'Terlalu banyak pembuatan transaksi booking dalam 1 jam terakhir. Silakan tunggu sebentar sebelum mencoba lagi.',
      );
    }

    const cat = (kost.propertyCategory || '').toUpperCase();
    const isDaily = cat === 'HUNIAN_HARIAN';
    const isYearly = cat === 'KONTRAKAN' && (kost.pricePerYear ?? 0) > 0;
    const durationUnit = isDaily ? 'DAY' : isYearly ? 'YEAR' : 'MONTH';
    const maxDuration = isDaily ? 30 : isYearly ? 5 : 12;
    const durationCount = Math.max(
      1,
      Math.min(maxDuration, Math.round(Number(params.durationCount) || 1)),
    );

    // Pengecekan bentrok tanggal (check-in s/d check-out) khusus HUNIAN_HARIAN (Villa / Homestay)
    if (isDaily) {
      const parseUtcDayMs = (dateStr: string): number | null => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateStr || '').trim());
        if (!m) return null;
        const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return Number.isFinite(ms) ? ms : null;
      };
      const reqStartMs = parseUtcDayMs(params.startDate);
      if (reqStartMs !== null) {
        const reqEndMs = reqStartMs + durationCount * 86_400_000;
        const activeDailyBookings = await this.bookingRepository.find({
          where: {
            kostId: params.kostId,
            bookingType: 'SEWA',
            paymentStatus: 'PAID',
            status: In(['DIBAYAR', 'DISETUJUI', 'APPROVED', 'AKTIF']),
          },
        });
        let overlappingCount = 0;
        for (const ab of activeDailyBookings) {
          if (ab.escrowStatus === 'REFUNDED') continue;
          const bStartMs = parseUtcDayMs(ab.startDate);
          if (bStartMs === null) continue;
          const bDays = Math.max(1, Number(ab.durationCount) || 1);
          const bEndMs = bStartMs + bDays * 86_400_000;
          if (bStartMs < reqEndMs && bEndMs > reqStartMs) {
            overlappingCount += 1;
          }
        }
        // Saat booking PAID, availableRooms sudah dikurangi 1, sehingga total kapasitas unit aktif = availableRooms + activeDailyBookings.length
        const activePaidCount = activeDailyBookings.filter(
          (ab) => ab.escrowStatus !== 'REFUNDED',
        ).length;
        const totalUnitCapacity = Math.max(
          1,
          Number(kost.availableRooms ?? 0) + activePaidCount,
        );
        if (overlappingCount >= totalUnitCapacity) {
          throw new BadRequestException(
            'Tanggal check-in hingga check-out yang dipilih sudah penuh/terisi untuk hunian harian ini. Silakan pilih tanggal lain.',
          );
        }
      }
    }
    const unitPrice =
      isDaily && (kost.pricePerDay ?? 0) > 0
        ? Number(kost.pricePerDay)
        : isYearly
          ? Number(kost.pricePerYear)
          : Number(kost.pricePerMonth);
    if (!unitPrice || unitPrice <= 0) {
      throw new BadRequestException(
        'Harga sewa properti belum tersedia untuk booking langsung.',
      );
    }

    const baseTotalAmount = unitPrice * durationCount;
    const canUseDp = !isDaily && (durationCount > 1 || isYearly);
    const effectiveScheme: 'FULL' | 'DP' =
      canUseDp && params.paymentScheme === 'DP' ? 'DP' : 'FULL';
    const payableRent =
      effectiveScheme === 'DP'
        ? Math.round(baseTotalAmount * 0.3)
        : baseTotalAmount;
    const remainingAmount = Math.max(0, baseTotalAmount - payableRent);

    const platformFeePercent =
      cfg?.bookingPlatformFeePercent ?? BOOKING_PLATFORM_FEE_PERCENT;
    const basePlatformFee = Math.round(
      (payableRent * platformFeePercent) / 100,
    );

    const user = await this.userRepository.findOne({
      where: { id: params.userId },
    });

    let pointsUsed = 0;
    let pointsDiscountAmount = 0;
    if (params.usePoints && user && Number(user.pointsBalance ?? 0) > 0) {
      const maxDiscount = Math.floor(basePlatformFee * 0.5);
      const pointCapByPayable = Math.max(0, payableRent - 1000);
      const maxPointsAllowed = Math.floor(
        Math.min(maxDiscount, pointCapByPayable) / POINT_RUPIAH_VALUE,
      );
      pointsUsed = Math.min(Number(user.pointsBalance ?? 0), maxPointsAllowed);
      pointsDiscountAmount = pointsUsed * POINT_RUPIAH_VALUE;
    }

    const netRentPayNow = Math.max(1000, payableRent - pointsDiscountAmount);
    const serviceFee = Math.max(5000, Math.round(netRentPayNow * 0.025));
    const paidAmount = netRentPayNow;
    const totalAmount = paidAmount;
    const platformFee = Math.max(0, basePlatformFee - pointsDiscountAmount);
    const ownerNetAmount = Math.max(0, payableRent - basePlatformFee - serviceFee);

    const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const paymentOrderId = `KYL-BOOK-${params.userId}-${Date.now()}-${randSuffix}`;

    const unitLabel = isDaily ? 'Hari' : isYearly ? 'Tahun' : 'Bulan';
    const schemeLabel = effectiveScheme === 'DP' ? 'DP 30%' : 'Full';
    const itemDetails: Array<{
      id: string;
      price: number;
      quantity: number;
      name: string;
    }> = [
      {
        id: `KOST-${kost.id}`,
        price: netRentPayNow,
        quantity: 1,
        name: `${kost.name} (${durationCount} ${unitLabel} - ${schemeLabel})`.slice(
          0,
          50,
        ),
      },
    ];

    const { serverKey, snapUrl } = this.midtransConfig;
    const webBaseUrl = (
      process.env.WEB_URL ||
      process.env.FRONTEND_URL ||
      'https://keyloka.com'
    )
      .trim()
      .replace(/\/+$/, '');
    const snapPayload = {
      transaction_details: {
        order_id: paymentOrderId,
        gross_amount: totalAmount,
      },
      item_details: itemDetails,
      customer_details: {
        first_name: params.tenantName || user?.name || 'Penyewa Keyloka',
        email: user?.email || undefined,
        phone: params.tenantPhone || user?.phone || undefined,
      },
      callbacks: {
        finish: `${webBaseUrl}/payment/finish`,
      },
    };

    const response = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this._basicAuthHeader(serverKey),
      },
      body: JSON.stringify(snapPayload),
    });

    const data = (await response.json()) as {
      token?: string;
      redirect_url?: string;
      error_messages?: string[];
      error?: string;
      status_message?: string;
    };

    if (!response.ok || !data.token || !data.redirect_url) {
      const msg =
        data.error_messages?.join(', ') ||
        data.status_message ||
        data.error ||
        'Gagal membuat transaksi pembayaran Midtrans.';
      throw new BadRequestException(`Midtrans: ${msg}`);
    }

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const userRepo = manager.getRepository(User);
      const pointRepo = manager.getRepository(PointTransaction);

      if (pointsUsed > 0) {
        const lockedUser = await userRepo.findOne({
          where: { id: params.userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedUser || Number(lockedUser.pointsBalance ?? 0) < pointsUsed) {
          throw new BadRequestException(
            'Saldo poin Anda tidak mencukupi. Silakan muat ulang dan coba lagi.',
          );
        }
        lockedUser.pointsBalance =
          Number(lockedUser.pointsBalance ?? 0) - pointsUsed;
        await userRepo.save(lockedUser);
      }

      const resolvedSchedule = this._resolveScheduleLabel(
        params.startDate,
        params.surveyDateTime,
        params.checkInTime,
        true,
      );

      const booking = bookingRepo.create({
        kostId: kost.id,
        userId: params.userId,
        ownerId: kost.ownerId,
        tenantName: params.tenantName.trim(),
        tenantPhone: params.tenantPhone.trim(),
        startDate: params.startDate.trim(),
        bookingType: 'SEWA',
        surveyDateTime: resolvedSchedule,
        status: 'MENUNGGU_PEMBAYARAN',
        notes: (params.notes || '').trim(),
        durationCount,
        durationUnit,
        totalAmount,
        platformFee,
        ownerNetAmount,
        serviceFee,
        paymentScheme: effectiveScheme,
        paidAmount,
        remainingAmount,
        paymentOrderId,
        snapToken: data.token,
        paymentUrl: data.redirect_url,
        paymentStatus: 'UNPAID',
        escrowStatus: 'NONE',
        pointsUsed,
        pointsDiscountAmount,
        pointsEarned: 0,
      });

      const saved = await bookingRepo.save(booking);
      if (pointsUsed > 0) {
        await pointRepo.save(
          pointRepo.create({
            userId: params.userId,
            bookingId: saved.id,
            points: pointsUsed,
            type: 'REDEEM',
            description: `Tukar poin untuk diskon booking ${kost.name}`,
          }),
        );
      }
      return saved;
    });
  }

  async syncDirectBookingByOrderId(
    paymentOrderId: string,
    requesterId: number,
    requesterRole?: string,
  ): Promise<Booking> {
    const existing = await this.bookingRepository.findOne({
      where: { paymentOrderId },
    });
    if (!existing) {
      throw new NotFoundException(
        `Booking dengan orderId ${paymentOrderId} tidak ditemukan.`,
      );
    }
    return this.syncDirectBookingPayment(
      existing.id,
      requesterId,
      requesterRole,
    );
  }

  async syncDirectBookingPayment(
    bookingId: number,
    requesterId: number,
    requesterRole?: string,
  ): Promise<Booking> {
    const existing = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });
    if (!existing) {
      throw new NotFoundException(`Booking ID ${bookingId} tidak ditemukan.`);
    }
    const role = (requesterRole || '').toUpperCase();
    const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
    if (!isStaff && existing.userId !== requesterId) {
      throw new ForbiddenException(
        'Anda tidak berhak memeriksa pembayaran booking ini.',
      );
    }
    if (existing.paymentStatus === 'PAID') {
      return existing;
    }
    if (!existing.paymentOrderId) {
      throw new BadRequestException('Order pembayaran belum tersedia.');
    }

    const { serverKey, statusBaseUrl } = this.midtransConfig;
    const response = await fetch(
      `${statusBaseUrl}/${encodeURIComponent(existing.paymentOrderId)}/status`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: this._basicAuthHeader(serverKey),
        },
      },
    );
    const data = (await response.json()) as {
      status_code?: string;
      transaction_status?: string;
      fraud_status?: string;
      gross_amount?: string;
      status_message?: string;
    };

    if (response.status === 404 || data.status_code === '404') {
      return existing;
    }
    if (!response.ok) {
      throw new BadRequestException(
        data.status_message || 'Gagal memeriksa status pembayaran Midtrans.',
      );
    }

    const txStatus = (data.transaction_status || '').toLowerCase();
    const fraud = (data.fraud_status || '').toLowerCase();
    const isPaid =
      txStatus === 'settlement' ||
      (txStatus === 'capture' && fraud !== 'challenge');
    const isExpired = txStatus === 'expire';
    const isFailed =
      txStatus === 'cancel' || txStatus === 'deny' || txStatus === 'failure';

    if (isPaid) {
      const paidAmount = data.gross_amount ? Math.round(Number(data.gross_amount)) : null;
      if (paidAmount !== null && Number.isFinite(paidAmount) && paidAmount !== Number(existing.totalAmount)) {
        throw new BadRequestException(
          'Nominal pembayaran Midtrans tidak sesuai dengan tagihan booking.',
        );
      }
      let transitionedToPaid = false;
      const updated = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const kostRepo = manager.getRepository(Kost);

        const lockedBooking = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!lockedBooking) {
          throw new NotFoundException('Booking tidak ditemukan.');
        }
        if (lockedBooking.paymentStatus === 'PAID') {
          return lockedBooking;
        }
        transitionedToPaid = true;

        const lockedKost = await kostRepo.findOne({
          where: { id: lockedBooking.kostId },
          lock: { mode: 'pessimistic_write' },
        });
        if (lockedKost && lockedKost.availableRooms > 0) {
          lockedKost.availableRooms -= 1;
          await kostRepo.save(lockedKost);
        }

        lockedBooking.paymentStatus = 'PAID';
        lockedBooking.status = 'DIBAYAR';
        lockedBooking.escrowStatus = 'HELD';
        return bookingRepo.save(lockedBooking);
      });

      const kost = await this.kostsService.findOne(updated.kostId);
      await this._handleDirectBookingPaidSideEffects(
        updated,
        kost,
        transitionedToPaid,
      );
      return updated;
    }

    if (isExpired || isFailed) {
      const expiredBooking = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const locked = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!locked) return existing;
        if (locked.paymentStatus === 'UNPAID' && locked.pointsUsed > 0) {
          await this._refundBookingPoints(manager, locked);
        }
        locked.paymentStatus = 'EXPIRED';
        locked.status = 'DIBATALKAN';
        return bookingRepo.save(locked);
      });
      await this._notifyDirectBookingExpired(expiredBooking);
      return expiredBooking;
    }

    return existing;
  }

  async applyMidtransWebhookPayment(
    paymentOrderId: string,
    transactionStatus: string,
    fraudStatus: string,
    grossAmount?: string,
  ): Promise<Booking> {
    const existing = await this.bookingRepository.findOne({
      where: { paymentOrderId },
    });
    if (!existing) {
      throw new NotFoundException(
        `Booking dengan orderId ${paymentOrderId} tidak ditemukan.`,
      );
    }
    if (existing.paymentStatus === 'PAID') return existing;

    const txStatus = transactionStatus.toLowerCase();
    const fraud = fraudStatus.toLowerCase();
    const isPaid =
      txStatus === 'settlement' ||
      (txStatus === 'capture' && fraud !== 'challenge');
    const isExpired = txStatus === 'expire';
    const isFailed =
      txStatus === 'cancel' || txStatus === 'deny' || txStatus === 'failure';

    if (isPaid) {
      const paidAmount = grossAmount ? Math.round(Number(grossAmount)) : null;
      if (paidAmount !== null && Number.isFinite(paidAmount) && paidAmount !== Number(existing.totalAmount)) {
        throw new BadRequestException(
          'Nominal webhook Midtrans tidak sesuai dengan tagihan booking.',
        );
      }
      let transitionedToPaid = false;
      const updated = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const kostRepo = manager.getRepository(Kost);

        const lockedBooking = await bookingRepo.findOne({
          where: { id: existing.id },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!lockedBooking) {
          throw new NotFoundException('Booking tidak ditemukan.');
        }
        if (lockedBooking.paymentStatus === 'PAID') {
          return lockedBooking;
        }
        transitionedToPaid = true;

        const lockedKost = await kostRepo.findOne({
          where: { id: lockedBooking.kostId },
          lock: { mode: 'pessimistic_write' },
        });
        if (lockedKost && lockedKost.availableRooms > 0) {
          lockedKost.availableRooms -= 1;
          await kostRepo.save(lockedKost);
        }

        lockedBooking.paymentStatus = 'PAID';
        lockedBooking.status = 'DIBAYAR';
        lockedBooking.escrowStatus = 'HELD';
        return bookingRepo.save(lockedBooking);
      });

      const kost = await this.kostsService.findOne(updated.kostId);
      await this._handleDirectBookingPaidSideEffects(
        updated,
        kost,
        transitionedToPaid,
      );
      return updated;
    }

    if (isExpired || isFailed) {
      const expiredBooking = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const locked = await bookingRepo.findOne({
          where: { id: existing.id },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!locked) return existing;
        if (locked.paymentStatus === 'UNPAID' && locked.pointsUsed > 0) {
          await this._refundBookingPoints(manager, locked);
        }
        locked.paymentStatus = 'EXPIRED';
        locked.status = 'DIBATALKAN';
        return bookingRepo.save(locked);
      });
      await this._notifyDirectBookingExpired(expiredBooking);
      return expiredBooking;
    }

    return existing;
  }

  async confirmCheckIn(bookingId: number, requesterId: number): Promise<Booking> {
    let ownerEmail = '';
    let ownerName = '';
    let ownerId: number | null = null;
    let kostName = '';
    const saved = await this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const kostRepo = manager.getRepository(Kost);
      const userRepo = manager.getRepository(User);

      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!booking) {
        throw new NotFoundException(`Booking ID ${bookingId} tidak ditemukan.`);
      }
      if (booking.userId !== requesterId) {
        throw new ForbiddenException(
          'Hanya penyewa yang melakukan booking yang dapat mengonfirmasi check-in.',
        );
      }
      if (booking.paymentStatus !== 'PAID' || booking.escrowStatus !== 'HELD') {
        throw new BadRequestException(
          'Booking ini tidak dalam status Escrow tertahan.',
        );
      }

      const kost = await kostRepo.findOne({ where: { id: booking.kostId } });
      if (!kost) {
        throw new NotFoundException('Properti tidak ditemukan.');
      }
      kostName = kost.name;
      ownerId = kost.ownerId;

      const owner = await userRepo.findOne({
        where: { id: kost.ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (owner) {
        ownerEmail = owner.email || '';
        ownerName = owner.name || '';
        owner.payoutBalance =
          Number(owner.payoutBalance ?? 0) + Number(booking.ownerNetAmount ?? 0);
        await userRepo.save(owner);
      }

      booking.escrowStatus = 'RELEASED';
      booking.status = 'AKTIF';
      booking.checkedInAt = new Date();
      booking.releasedAt = new Date();
      const earned = await this._awardBookingPoints(manager, booking, kost.name);
      booking.pointsEarned = earned;
      return bookingRepo.save(booking);
    });

    const netStr = Number(saved.ownerNetAmount ?? 0).toLocaleString('id-ID');
    await this._createNotificationSafe({
      userId: ownerId || saved.ownerId,
      type: 'ESCROW',
      title: `Dana Escrow Cair • ${kostName}`,
      body: `${saved.tenantName} telah check-in. Dana bersih Rp${netStr} masuk ke saldo penghasilan Anda.`,
      targetUrl: '/dashboard?tab=WALLET',
    });
    await this._createNotificationSafe({
      userId: saved.userId,
      type: 'BOOKING',
      title: `Check-In Dikonfirmasi • ${kostName}`,
      body: `Check-in Anda telah dikonfirmasi. Anda mendapatkan ${saved.pointsEarned} poin loyalti.`,
      targetUrl: '/bookings',
    });

    if (ownerEmail) {
      void this.mailService?.sendEmail(ownerEmail, {
        subject: `[Keyloka] Dana Escrow Rp${netStr} Diteruskan • ${kostName}`,
        badgeText: 'Escrow Cair',
        badgeTone: 'emerald',
        title: 'Penyewa Check-In — Dana Escrow Diteruskan',
        greetingName: ownerName,
        intro:
          'Penyewa telah mengonfirmasi check-in. Dana bersih sewa kini sudah masuk ke saldo penghasilan Anda dan siap ditarik.',
        details: [
          { label: 'Properti', value: kostName },
          { label: 'Penyewa', value: saved.tenantName },
          { label: 'Dana Diteruskan', value: `Rp${netStr}` },
        ],
        ctaLabel: 'Buka Dompet Penghasilan',
        ctaUrl: '/dashboard?tab=WALLET',
      });
    }

    return saved;
  }

  async reportDispute(
    bookingId: number,
    requesterId: number,
    reason: string,
  ): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${bookingId} tidak ditemukan.`);
    }
    if (booking.userId !== requesterId) {
      throw new ForbiddenException(
        'Hanya penyewa terkait yang dapat melaporkan kendala booking ini.',
      );
    }
    if (booking.paymentStatus !== 'PAID' || booking.escrowStatus !== 'HELD') {
      throw new BadRequestException(
        'Kendala hanya dapat dilaporkan saat dana masih ditahan di Escrow.',
      );
    }
    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 5) {
      throw new BadRequestException(
        'Mohon jelaskan kendala minimal 5 karakter.',
      );
    }

    booking.escrowStatus = 'DISPUTED';
    booking.disputeReason = cleanReason;
    const saved = await this.bookingRepository.save(booking);
    const ownerId = booking.ownerId || booking.kost?.ownerId;
    await this._createNotificationSafe({
      userId: ownerId,
      type: 'DISPUTE',
      title: `Kendala Booking Dilaporkan • ${booking.kost?.name || `Properti #${booking.kostId}`}`,
      body: `${booking.tenantName} melaporkan kendala: "${cleanReason}". Dana ditahan sementara hingga admin meninjau.`,
      targetUrl: '/dashboard?tab=DISPUTES',
    });
    return saved;
  }

  async resolveDispute(
    bookingId: number,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<Booking> {
    const resolved = await this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const kostRepo = manager.getRepository(Kost);
      const userRepo = manager.getRepository(User);

      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (!booking) {
        throw new NotFoundException(`Booking ID ${bookingId} tidak ditemukan.`);
      }
      if (booking.escrowStatus !== 'DISPUTED') {
        throw new BadRequestException(
          'Booking ini tidak sedang dalam status sengketa.',
        );
      }

      const kost = await kostRepo.findOne({
        where: { id: booking.kostId },
        lock: { mode: 'pessimistic_write' },
      });

      if (resolution === 'RELEASE') {
        if (kost) {
          const owner = await userRepo.findOne({
            where: { id: kost.ownerId },
            lock: { mode: 'pessimistic_write' },
          });
          if (owner) {
            owner.payoutBalance =
              Number(owner.payoutBalance ?? 0) +
              Number(booking.ownerNetAmount ?? 0);
            await userRepo.save(owner);
          }
        }
        booking.escrowStatus = 'RELEASED';
        booking.status = 'AKTIF';
        booking.releasedAt = new Date();
        booking.pointsEarned = await this._awardBookingPoints(
          manager,
          booking,
          kost?.name || 'Properti Keyloka',
        );
      } else {
        if (kost) {
          kost.availableRooms += 1;
          await kostRepo.save(kost);
        }
        if (booking.pointsUsed > 0) {
          await this._refundBookingPoints(manager, booking);
        }
        booking.escrowStatus = 'REFUNDED';
        booking.paymentStatus = 'REFUNDED';
        booking.status = 'DIBATALKAN';
      }

      return bookingRepo.save(booking);
    });

    const kost = await this.kostsService.findOne(resolved.kostId).catch(() => null);
    const propName = kost?.name || `Properti #${resolved.kostId}`;
    const isReleased = resolution === 'RELEASE';
    await this._createNotificationSafe({
      userId: resolved.userId,
      type: 'DISPUTE',
      title: `Sengketa Booking Selesai • ${propName}`,
      body: isReleased
        ? `Admin telah menyelesaikan sengketa dan meneruskan dana Escrow ke pemilik. Booking Anda kini aktif.`
        : `Admin telah menyetujui pengembalian dana (refund) untuk booking Anda di ${propName}.`,
      targetUrl: '/bookings',
    });
    await this._createNotificationSafe({
      userId: resolved.ownerId || kost?.ownerId,
      type: 'DISPUTE',
      title: `Sengketa Booking Selesai • ${propName}`,
      body: isReleased
        ? `Admin menyelesaikan sengketa booking ${resolved.tenantName} dan meneruskan dana ke saldo Anda.`
        : `Admin menyetujui refund untuk booking ${resolved.tenantName} di ${propName}.`,
      targetUrl: '/dashboard?tab=WALLET',
    });

    return resolved;
  }

  private _computeLevelInfo(totalPoints: number) {
    if (totalPoints >= 700) {
      return {
        level: 'Platinum',
        nextLevel: null as string | null,
        currentMin: 700,
        nextTarget: 700,
      };
    }
    if (totalPoints >= 300) {
      return {
        level: 'Gold',
        nextLevel: 'Platinum',
        currentMin: 300,
        nextTarget: 700,
      };
    }
    if (totalPoints >= 100) {
      return {
        level: 'Silver',
        nextLevel: 'Gold',
        currentMin: 100,
        nextTarget: 300,
      };
    }
    return {
      level: 'Bronze',
      nextLevel: 'Silver',
      currentMin: 0,
      nextTarget: 100,
    };
  }

  private async _handleDirectBookingPaidSideEffects(
    updated: Booking,
    kost: Kost,
    transitionedToPaid: boolean,
  ): Promise<void> {
    if (transitionedToPaid) {
      const scheduleStr = updated.surveyDateTime || updated.startDate;
      const paidStr = Number(updated.paidAmount ?? 0).toLocaleString('id-ID');
      void this._sendDirectBookingPaidEmails(updated, kost);
      await this._createNotificationSafe({
        userId: updated.userId,
        type: 'BOOKING',
        title: `Pembayaran Booking Berhasil • ${kost.name}`,
        body: `Pembayaran Rp${paidStr} untuk jadwal masuk ${scheduleStr} berhasil diterima dan diamankan oleh Escrow Keyloka.`,
        targetUrl: '/bookings',
      });
      if (kost.ownerId && kost.ownerId !== updated.userId) {
        await this._createNotificationSafe({
          userId: kost.ownerId,
          type: 'BOOKING',
          title: `Booking Baru Dibayar • ${kost.name}`,
          body: `${updated.tenantName} telah membayar booking untuk jadwal masuk ${scheduleStr}.`,
          targetUrl: '/bookings',
        });
      }
    }
    if (kost.ownerId && updated.userId && kost.ownerId !== updated.userId) {
      const scheduleStr = updated.surveyDateTime || updated.startDate;
      const unitLabel =
        updated.durationUnit === 'DAY'
          ? 'hari'
          : updated.durationUnit === 'YEAR'
            ? 'tahun'
            : 'bulan';
      try {
        const autoChat = await this.chatsService.createMessage({
          kostId: updated.kostId,
          senderId: updated.userId,
          senderName: updated.tenantName,
          receiverId: kost.ownerId,
          message: `Halo, saya telah membayar booking untuk ${kost.name} (${updated.durationCount} ${unitLabel}) mulai ${scheduleStr}. Dana aman di Escrow Keyloka hingga saya konfirmasi check-in.`,
          bookingId: updated.id,
        });
        await this.chatsGateway.notifyNewChatMessage(autoChat);
      } catch (err) {
        this.logger.warn(
          `Gagal mengirim auto-chat bookingId=${updated.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async _notifyDirectBookingExpired(booking: Booking): Promise<void> {
    if (!booking.userId) return;
    const kost = await this.kostsService.findOne(booking.kostId).catch(() => null);
    const propName = kost?.name || `Properti #${booking.kostId}`;
    await this._createNotificationSafe({
      userId: booking.userId,
      type: 'BOOKING',
      title: `Booking Dibatalkan / Kedaluwarsa • ${propName}`,
      body: `Pembayaran booking Anda untuk ${propName} telah kedaluwarsa atau gagal diproses.`,
      targetUrl: '/bookings',
    });
  }

  private async _sendDirectBookingPaidEmails(booking: Booking, kost: Kost) {
    const paidStr = Number(booking.paidAmount ?? 0).toLocaleString('id-ID');
    const unitLabel =
      booking.durationUnit === 'DAY'
        ? 'hari'
        : booking.durationUnit === 'YEAR'
          ? 'tahun'
          : 'bulan';
    const durationStr = `${booking.durationCount} ${unitLabel}`;
    const scheduleStr = booking.surveyDateTime || booking.startDate;

    const [tenant, owner] = await Promise.all([
      booking.userId
        ? this.userRepository.findOne({ where: { id: booking.userId } })
        : Promise.resolve(null),
      kost.ownerId
        ? this.userRepository.findOne({ where: { id: kost.ownerId } })
        : Promise.resolve(null),
    ]);

    if (tenant?.email) {
      await this.mailService?.sendEmail(tenant.email, {
        subject: `[Keyloka] Pembayaran Booking ${kost.name} Berhasil`,
        badgeText: 'Pembayaran Berhasil',
        badgeTone: 'emerald',
        title: 'Pembayaran Booking Anda Berhasil',
        greetingName: tenant.name || booking.tenantName,
        intro:
          'Pembayaran Anda telah kami terima. Dana Anda ditahan aman di Escrow Keyloka hingga Anda mengonfirmasi Check-In di lokasi.',
        details: [
          { label: 'Kode Order', value: booking.paymentOrderId || `#${booking.id}` },
          { label: 'Properti', value: kost.name },
          { label: 'Jadwal Masuk', value: scheduleStr },
          { label: 'Durasi', value: durationStr },
          { label: 'Total Dibayar', value: `Rp${paidStr}` },
        ],
        ctaLabel: 'Lihat Booking & Konfirmasi Check-In',
        ctaUrl: '/bookings',
      });
    }

    const cfg = await this.platformService?.getSettings().catch(() => null);
    const opsEmail = (cfg?.opsNotificationEmail || '').trim();
    const ownerRole = (owner?.role || '').toUpperCase();
    const isStaffOwner = ownerRole === 'STAFF' || ownerRole === 'ADMINISTRATOR';
    const recipientOwnerEmail =
      (isStaffOwner && opsEmail) || owner?.email || opsEmail || '';

    if (!recipientOwnerEmail) {
      this.logger.warn(
        `Email pemilik dilewati untuk bookingId=${booking.id} kostId=${kost.id} ownerId=${kost.ownerId}: email pemilik kosong`,
      );
      void this.platformService?.recordEvent({
        level: 'WARN',
        category: 'BOOKING',
        message: `Email pemilik dilewati untuk booking #${booking.id} (${kost.name}): email kosong`,
        meta: { bookingId: booking.id, kostId: kost.id, ownerId: kost.ownerId },
      });
    } else if (owner?.id !== tenant?.id || recipientOwnerEmail !== tenant?.email) {
      await this.mailService?.sendEmail(recipientOwnerEmail, {
        subject: `[Keyloka] Booking Baru Dibayar • ${kost.name}`,
        badgeText: 'Booking Dibayar',
        badgeTone: 'emerald',
        title: 'Ada Booking Baru yang Sudah Dibayar',
        greetingName: owner?.name || 'Tim Operasional Keyloka',
        intro:
          'Penyewa telah menyelesaikan pembayaran. Dana ditahan aman di Escrow dan akan diteruskan ke saldo penghasilan Anda setelah penyewa check-in.',
        details: [
          { label: 'Properti', value: kost.name },
          { label: 'Penyewa', value: booking.tenantName },
          { label: 'Jadwal Masuk', value: scheduleStr },
          { label: 'Durasi', value: durationStr },
          { label: 'Total Dibayar Penyewa', value: `Rp${paidStr}` },
        ],
        ctaLabel: 'Kelola Booking di Dashboard',
        ctaUrl: '/dashboard',
      });
    }
  }

  private async _awardBookingPoints(
    manager: import('typeorm').EntityManager,
    booking: Booking,
    kostName: string,
  ): Promise<number> {
    if (!booking.userId || booking.pointsEarned > 0) return booking.pointsEarned;
    const earned = Math.floor(
      Number(booking.totalAmount ?? 0) / RUPIAH_PER_POINT_EARNED,
    );
    if (earned <= 0) return 0;

    const userRepo = manager.getRepository(User);
    const pointRepo = manager.getRepository(PointTransaction);
    const tenant = await userRepo.findOne({
      where: { id: booking.userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tenant) return 0;

    tenant.pointsBalance = Number(tenant.pointsBalance ?? 0) + earned;
    tenant.totalPointsEarned = Number(tenant.totalPointsEarned ?? 0) + earned;
    await userRepo.save(tenant);

    await pointRepo.save(
      pointRepo.create({
        userId: booking.userId,
        bookingId: booking.id,
        points: earned,
        type: 'EARN',
        description: `Poin check-in booking ${kostName}`,
      }),
    );
    return earned;
  }

  private async _refundBookingPoints(
    manager: import('typeorm').EntityManager,
    booking: Booking,
  ): Promise<void> {
    if (!booking.userId || booking.pointsUsed <= 0) return;
    const userRepo = manager.getRepository(User);
    const pointRepo = manager.getRepository(PointTransaction);
    const tenant = await userRepo.findOne({
      where: { id: booking.userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tenant) return;

    const refunded = booking.pointsUsed;
    tenant.pointsBalance = Number(tenant.pointsBalance ?? 0) + refunded;
    await userRepo.save(tenant);

    booking.pointsUsed = 0;
    booking.pointsDiscountAmount = 0;

    await pointRepo.save(
      pointRepo.create({
        userId: tenant.id,
        bookingId: booking.id,
        points: refunded,
        type: 'REFUND',
        description: 'Pengembalian poin dari booking yang dibatalkan/kedaluwarsa',
      }),
    );
  }

  async getMyLoyaltySummary(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }
    const totalPointsEarned = Number(user.totalPointsEarned ?? 0);
    const pointsBalance = Number(user.pointsBalance ?? 0);
    const levelInfo = this._computeLevelInfo(totalPointsEarned);
    const transactions = await this.pointTxRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    return {
      pointsBalance,
      totalPointsEarned,
      pointValueRupiah: POINT_RUPIAH_VALUE,
      rupiahPerPointEarned: RUPIAH_PER_POINT_EARNED,
      ...levelInfo,
      transactions,
    };
  }
}
