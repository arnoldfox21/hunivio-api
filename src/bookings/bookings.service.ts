import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { KostsService } from '../kosts/kosts.service';
import { ChatsService } from '../chats/chats.service';
import { ChatsGateway } from '../chats/chats.gateway';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly kostsService: KostsService,
    private readonly chatsService: ChatsService,
    private readonly chatsGateway: ChatsGateway,
  ) {}

  async create(dto: CreateBookingDto): Promise<Booking> {
    const kost = await this.kostsService.findOne(dto.kostId);
    if ((kost.approvalStatus || 'APPROVED').toUpperCase() !== 'APPROVED') {
      throw new BadRequestException(
        'Properti ini belum disetujui dan belum dapat disewa.',
      );
    }
    if (dto.userId && dto.userId > 0 && kost.ownerId === dto.userId) {
      throw new BadRequestException(
        'Anda tidak dapat mengajukan sewa atau survei pada properti milik sendiri.',
      );
    }
    const isSurvey = (dto.bookingType || 'SEWA').toUpperCase() === 'SURVEI';
    if (!isSurvey && kost.availableRooms <= 0) {
      throw new BadRequestException(
        'Maaf, kamar pada properti ini sudah penuh.',
      );
    }
    const type = isSurvey ? 'SURVEI' : 'SEWA';

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

    const totalPrice = isSurvey ? 0 : kost.pricePerMonth * dto.durationMonths;

    const booking = this.bookingRepository.create({
      ...dto,
      bookingType: isSurvey ? 'SURVEI' : 'SEWA',
      surveyDateTime: dto.surveyDateTime || '',
      paymentMethod: 'LUAR_APP',
      paymentStatus: 'LUAR_APP',
      invoiceNumber: '',
      totalPrice,
      status: 'TERKIRIM',
    });

    const saved = await this.bookingRepository.save(booking);

    // Kirim pesan chat masuk otomatis ke pemilik sebagai info pengajuan
    if (dto.userId && dto.userId > 0 && kost.ownerId !== dto.userId) {
      const notesLine = dto.notes?.trim()
        ? `\nCatatan: ${dto.notes.trim()}`
        : '';
      const autoMessage = isSurvey
        ? `Halo, saya ${dto.tenantName} (${dto.tenantPhone}) mengajukan jadwal SURVEI untuk ${kost.name} pada ${dto.surveyDateTime || dto.startDate}.${notesLine}`
        : `Halo, saya ${dto.tenantName} (${dto.tenantPhone}) mengajukan SEWA untuk ${kost.name} mulai ${dto.startDate} selama ${dto.durationMonths} bulan (estimasi Rp ${totalPrice.toLocaleString('id-ID')}). Mohon info lanjutannya ya.${notesLine}`;
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

    return qb.getMany();
  }

  async updateStatus(id: number, status: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
    }
    const prevStatus = (booking.status || '').toUpperCase();
    booking.status = status.toUpperCase();
    if (
      booking.status === 'DISETUJUI' &&
      booking.bookingType === 'SEWA' &&
      booking.paymentStatus === 'BELUM_BAYAR'
    ) {
      booking.paymentStatus = 'MENUNGGU_PEMBAYARAN';
    }
    const saved = await this.bookingRepository.save(booking);
    if (
      booking.bookingType === 'SEWA' &&
      booking.status === 'DITOLAK' &&
      prevStatus !== 'DITOLAK'
    ) {
      await this.kostsService.incrementAvailableRoom(booking.kostId);
    }
    return saved;
  }

  async cancelBooking(id: number, requesterId?: number): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
    }
    const kost = await this.kostsService.findOne(booking.kostId);
    if (requesterId && requesterId > 0) {
      const isTenant = booking.userId === requesterId;
      const isOwner = kost.ownerId === requesterId;
      if (!isTenant && !isOwner) {
        throw new BadRequestException(
          'Anda tidak memiliki izin untuk membatalkan pengajuan ini.',
        );
      }
    }
    booking.status = 'DIBATALKAN';
    return this.bookingRepository.save(booking);
  }

  async payBooking(id: number, paymentMethod?: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException(`Booking ID ${id} tidak ditemukan`);
    }
    if (paymentMethod) {
      booking.paymentMethod = paymentMethod;
    }
    if (!booking.invoiceNumber) {
      booking.invoiceNumber = `INV-HG-${Date.now().toString().slice(-6)}`;
    }
    booking.paymentStatus = 'LUNAS';
    booking.status = 'AKTIF';
    return this.bookingRepository.save(booking);
  }
}
