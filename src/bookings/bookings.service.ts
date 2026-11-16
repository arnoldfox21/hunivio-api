import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
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

export const BOOKING_PLATFORM_FEE_PERCENT = 5;
export const POINT_RUPIAH_VALUE = 50; // 1 poin = Rp50
export const RUPIAH_PER_POINT_EARNED = 10000; // Rp10.000 = 1 poin

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
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
  ) {}

  onModuleInit() {
    this._escrowTimer = setInterval(() => {
      this.autoReleaseExpiredHeldEscrows().catch(() => {});
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
        await this.dataSource.transaction(async (manager) => {
          const bookingRepo = manager.getRepository(Booking);
          const kostRepo = manager.getRepository(Kost);
          const userRepo = manager.getRepository(User);

          const locked = await bookingRepo.findOne({
            where: { id: b.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked || locked.escrowStatus !== 'HELD') return;

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
            kost?.name || 'Properti HuniVio',
          );
          await bookingRepo.save(locked);
          releasedCount += 1;
        });
      } catch {
        // Skip failed item and continue
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

    const booking = this.bookingRepository.create({
      ...dto,
      bookingType: type,
      surveyDateTime: dto.surveyDateTime || dto.startDate,
      status: 'TERKIRIM',
    });

    const saved = await this.bookingRepository.save(booking);

    // Kirim pesan chat masuk otomatis ke pemilik sebagai info pengajuan
    if (dto.userId && dto.userId > 0 && kost.ownerId !== dto.userId) {
      const notesLine = dto.notes?.trim()
        ? `\nCatatan: ${dto.notes.trim()}`
        : '';
      const autoMessage = `Halo, saya ${dto.tenantName} (${dto.tenantPhone}) mengajukan jadwal SURVEI untuk ${kost.name} pada ${dto.surveyDateTime || dto.startDate}.${notesLine}`;
      try {
        const autoChat = await this.chatsService.createMessage({
          kostId: dto.kostId,
          senderId: dto.userId,
          senderName: dto.tenantName,
          receiverId: kost.ownerId,
          message: autoMessage,
        });
        await this.chatsGateway.notifyNewChatMessage(autoChat);
      } catch {
        // Jangan gagalkan penyimpanan pengajuan jika auto-chat gagal
      }
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
      qb.andWhere('kost.ownerId = :ownerId', { ownerId: query!.ownerId });
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
    if (
      requesterId &&
      kost.ownerId !== requesterId &&
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

    if (
      prevStatus !== nextStatus &&
      booking.userId &&
      booking.userId > 0 &&
      kost.ownerId !== booking.userId
    ) {
      const jenis = booking.bookingType === 'SURVEI' ? 'survei' : 'sewa';
      let notifText = '';
      if (nextStatus === 'DISETUJUI' || nextStatus === 'APPROVED') {
        notifText = `Pengajuan ${jenis} Anda untuk ${kost.name} telah DISETUJUI oleh pemilik. Silakan koordinasi langkah selanjutnya melalui chat ini.`;
      } else if (nextStatus === 'DITOLAK') {
        notifText = `Maaf, pengajuan ${jenis} Anda untuk ${kost.name} belum dapat disetujui pemilik.`;
      } else if (nextStatus === 'AKTIF') {
        notifText = `Status sewa Anda di ${kost.name} kini AKTIF. Selamat menempati properti!`;
      } else if (nextStatus === 'SELESAI') {
        notifText = `Masa sewa Anda di ${kost.name} telah ditandai SELESAI. Terima kasih telah menggunakan HuniVio.`;
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
      const isOwner = kost.ownerId === requesterId;
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

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const locked = await bookingRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
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
    durationCount: number;
    notes?: string;
    usePoints?: boolean;
  }): Promise<Booking> {
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
    if (kost.availableRooms <= 0) {
      throw new BadRequestException(
        'Maaf, saat ini tidak ada kamar/unit yang tersedia.',
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
    if (unpaidCount >= 2) {
      throw new BadRequestException(
        'Anda memiliki 2 booking yang belum dibayar. Selesaikan atau batalkan terlebih dahulu.',
      );
    }

    const isDaily =
      (kost.propertyCategory || '').toUpperCase() === 'HUNIAN_HARIAN';
    const durationUnit = isDaily ? 'DAY' : 'MONTH';
    const durationCount = Math.max(
      1,
      Math.min(isDaily ? 30 : 12, Math.round(Number(params.durationCount) || 1)),
    );
    const unitPrice =
      isDaily && (kost.pricePerDay ?? 0) > 0
        ? Number(kost.pricePerDay)
        : Number(kost.pricePerMonth);
    if (!unitPrice || unitPrice <= 0) {
      throw new BadRequestException(
        'Harga sewa properti belum tersedia untuk booking langsung.',
      );
    }

    const baseTotalAmount = unitPrice * durationCount;
    const basePlatformFee = Math.round(
      (baseTotalAmount * BOOKING_PLATFORM_FEE_PERCENT) / 100,
    );
    const ownerNetAmount = baseTotalAmount - basePlatformFee;

    const user = await this.userRepository.findOne({
      where: { id: params.userId },
    });

    let pointsUsed = 0;
    let pointsDiscountAmount = 0;
    if (params.usePoints && user && Number(user.pointsBalance ?? 0) > 0) {
      const maxDiscount = Math.floor(basePlatformFee * 0.5);
      const maxPointsAllowed = Math.floor(maxDiscount / POINT_RUPIAH_VALUE);
      pointsUsed = Math.min(Number(user.pointsBalance ?? 0), maxPointsAllowed);
      pointsDiscountAmount = pointsUsed * POINT_RUPIAH_VALUE;
    }

    const rawNet = baseTotalAmount - pointsDiscountAmount;
    const totalAmount = Math.max(1000, rawNet);
    const platformFee = Math.max(0, basePlatformFee - pointsDiscountAmount);

    const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const paymentOrderId = `HNV-BOOK-${params.userId}-${Date.now()}-${randSuffix}`;

    const itemDetails: Array<{
      id: string;
      price: number;
      quantity: number;
      name: string;
    }> =
      rawNet >= 1000
        ? [
            {
              id: `KOST-${kost.id}`,
              price: unitPrice,
              quantity: durationCount,
              name: `${kost.name} (${durationCount} ${isDaily ? 'Hari' : 'Bulan'})`.slice(
                0,
                50,
              ),
            },
            ...(pointsDiscountAmount > 0
              ? [
                  {
                    id: 'HUNIVIO-POINTS-DISCOUNT',
                    price: -pointsDiscountAmount,
                    quantity: 1,
                    name: `Potongan ${pointsUsed} Poin HuniVio`,
                  },
                ]
              : []),
          ]
        : [
            {
              id: `KOST-${kost.id}`,
              price: totalAmount,
              quantity: 1,
              name: `${kost.name} (${durationCount} ${isDaily ? 'Hari' : 'Bulan'})`.slice(
                0,
                50,
              ),
            },
          ];

    const { serverKey, snapUrl } = this.midtransConfig;
    const snapPayload = {
      transaction_details: {
        order_id: paymentOrderId,
        gross_amount: totalAmount,
      },
      item_details: itemDetails,
      customer_details: {
        first_name: params.tenantName || user?.name || 'Penyewa HuniVio',
        email: user?.email || undefined,
        phone: params.tenantPhone || user?.phone || undefined,
      },
      callbacks: {
        finish: 'https://hunivio.app/payment/finish',
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

      const booking = bookingRepo.create({
        kostId: kost.id,
        userId: params.userId,
        tenantName: params.tenantName.trim(),
        tenantPhone: params.tenantPhone.trim(),
        startDate: params.startDate.trim(),
        bookingType: 'SEWA',
        surveyDateTime: '',
        status: 'MENUNGGU_PEMBAYARAN',
        notes: (params.notes || '').trim(),
        durationCount,
        durationUnit,
        totalAmount,
        platformFee,
        ownerNetAmount,
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
      const updated = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const kostRepo = manager.getRepository(Kost);

        const lockedBooking = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedBooking) {
          throw new NotFoundException('Booking tidak ditemukan.');
        }
        if (lockedBooking.paymentStatus === 'PAID') {
          return lockedBooking;
        }

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
      if (kost.ownerId && updated.userId && kost.ownerId !== updated.userId) {
        try {
          const autoChat = await this.chatsService.createMessage({
            kostId: updated.kostId,
            senderId: updated.userId,
            senderName: updated.tenantName,
            receiverId: kost.ownerId,
            message: `Halo, saya telah membayar booking untuk ${kost.name} (${updated.durationCount} ${updated.durationUnit === 'DAY' ? 'hari' : 'bulan'}) mulai ${updated.startDate}. Dana aman di Escrow HuniVio hingga saya konfirmasi check-in.`,
          });
          await this.chatsGateway.notifyNewChatMessage(autoChat);
        } catch {
          // Abaikan kegagalan notifikasi chat
        }
      }
      return updated;
    }

    if (isExpired || isFailed) {
      return this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const locked = await bookingRepo.findOne({
          where: { id: bookingId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) return existing;
        if (locked.paymentStatus === 'UNPAID' && locked.pointsUsed > 0) {
          await this._refundBookingPoints(manager, locked);
        }
        locked.paymentStatus = 'EXPIRED';
        locked.status = 'DIBATALKAN';
        return bookingRepo.save(locked);
      });
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
      const updated = await this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const kostRepo = manager.getRepository(Kost);

        const lockedBooking = await bookingRepo.findOne({
          where: { id: existing.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedBooking) {
          throw new NotFoundException('Booking tidak ditemukan.');
        }
        if (lockedBooking.paymentStatus === 'PAID') {
          return lockedBooking;
        }

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
      if (kost.ownerId && updated.userId && kost.ownerId !== updated.userId) {
        try {
          const autoChat = await this.chatsService.createMessage({
            kostId: updated.kostId,
            senderId: updated.userId,
            senderName: updated.tenantName,
            receiverId: kost.ownerId,
            message: `Halo, saya telah membayar booking untuk ${kost.name} (${updated.durationCount} ${updated.durationUnit === 'DAY' ? 'hari' : 'bulan'}) mulai ${updated.startDate}. Dana aman di Escrow HuniVio hingga saya konfirmasi check-in.`,
          });
          await this.chatsGateway.notifyNewChatMessage(autoChat);
        } catch {
          // Abaikan kegagalan notifikasi chat
        }
      }
      return updated;
    }

    if (isExpired || isFailed) {
      return this.dataSource.transaction(async (manager) => {
        const bookingRepo = manager.getRepository(Booking);
        const locked = await bookingRepo.findOne({
          where: { id: existing.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) return existing;
        if (locked.paymentStatus === 'UNPAID' && locked.pointsUsed > 0) {
          await this._refundBookingPoints(manager, locked);
        }
        locked.paymentStatus = 'EXPIRED';
        locked.status = 'DIBATALKAN';
        return bookingRepo.save(locked);
      });
    }

    return existing;
  }

  async confirmCheckIn(bookingId: number, requesterId: number): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const kostRepo = manager.getRepository(Kost);
      const userRepo = manager.getRepository(User);

      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
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

      const owner = await userRepo.findOne({
        where: { id: kost.ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (owner) {
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
    return this.bookingRepository.save(booking);
  }

  async resolveDispute(
    bookingId: number,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const kostRepo = manager.getRepository(Kost);
      const userRepo = manager.getRepository(User);

      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
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
          kost?.name || 'Properti HuniVio',
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
