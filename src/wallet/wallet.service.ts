import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { PayoutRequest } from './entities/payout-request.entity';
import { User } from '../users/entities/user.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { CreateTopupDto } from './dto/create-topup.dto';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { PlatformService } from '../platform/platform.service';

export const FREE_PROPERTY_QUOTA = 2;
export const EXTRA_PROPERTY_SLOT_FEE = 10000;

export interface BoostPackage {
  code: string;
  label: string;
  days: number;
  price: number;
}

export const BOOST_PACKAGES: Record<string, BoostPackage> = {
  BOOST_3D: { code: 'BOOST_3D', label: '3 Hari', days: 3, price: 5000 },
  BOOST_7D: { code: 'BOOST_7D', label: '7 Hari', days: 7, price: 10000 },
  BOOST_14D: { code: 'BOOST_14D', label: '14 Hari', days: 14, price: 18000 },
};

const OWNER_ELIGIBLE_ROLES = new Set([
  'PEMILIK_KOST',
  'PEMILIK',
  'STAFF',
  'ADMINISTRATOR',
]);

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(WalletTransaction)
    private readonly walletRepo: Repository<WalletTransaction>,
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly platformService?: PlatformService,
  ) {}

  private get midtransConfig() {
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
    const clientKey = (process.env.MIDTRANS_CLIENT_KEY || '').trim();
    const signatureKey = (
      process.env.MIDTRANS_SIGNATURE_KEY || serverKey
    ).trim();
    if (!serverKey) {
      throw new InternalServerErrorException(
        'Konfigurasi Midtrans Server Key belum tersedia.',
      );
    }
    return {
      isProd,
      serverKey,
      clientKey,
      signatureKey,
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

  private _assertEligibleUser(user: User): void {
    const role = (user.role || '').trim().toUpperCase();
    if (!OWNER_ELIGIBLE_ROLES.has(role)) {
      throw new ForbiddenException(
        'Fitur top-up kredit hanya tersedia untuk akun Pemilik Kost, Staff, atau Administrator.',
      );
    }
  }

  async getPricing() {
    const cfg = await this.platformService?.getSettings().catch(() => null);
    return {
      freePropertyQuota: cfg?.freePropertyQuota ?? FREE_PROPERTY_QUOTA,
      extraPropertySlotFee: cfg?.extraPropertySlotFee ?? EXTRA_PROPERTY_SLOT_FEE,
      minWithdrawAmount: cfg?.minWithdrawAmount ?? 10000,
      boostPackages: [
        {
          ...BOOST_PACKAGES.BOOST_3D,
          price: cfg?.boost3dPrice ?? BOOST_PACKAGES.BOOST_3D.price,
        },
        {
          ...BOOST_PACKAGES.BOOST_7D,
          price: cfg?.boost7dPrice ?? BOOST_PACKAGES.BOOST_7D.price,
        },
        {
          ...BOOST_PACKAGES.BOOST_14D,
          price: cfg?.boost14dPrice ?? BOOST_PACKAGES.BOOST_14D.price,
        },
      ],
    };
  }

  async deductCredit(params: {
    userId: number;
    amount: number;
    type: 'BOOST' | 'SLOT_FEE';
    description: string;
    manager?: EntityManager;
  }): Promise<{ creditBalance: number; transaction: WalletTransaction }> {
    const run = async (manager: EntityManager) => {
      const userRepo = manager.getRepository(User);
      const txRepo = manager.getRepository(WalletTransaction);

      const user = await userRepo.findOne({
        where: { id: params.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('Pengguna tidak ditemukan.');
      }

      const currentBalance = Number(user.creditBalance ?? 0);
      if (currentBalance < params.amount) {
        throw new BadRequestException(
          `Saldo kredit tidak mencukupi (dibutuhkan Rp${params.amount.toLocaleString('id-ID')}, saldo Anda Rp${currentBalance.toLocaleString('id-ID')}). Silakan top-up terlebih dahulu.`,
        );
      }

      user.creditBalance = currentBalance - params.amount;
      await userRepo.save(user);

      const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const tx = txRepo.create({
        userId: params.userId,
        orderId: `KYL-USE-${params.userId}-${Date.now()}-${randSuffix}`,
        amount: params.amount,
        type: params.type,
        status: 'PAID',
        snapToken: null,
        paymentUrl: null,
        paymentMethod: 'CREDIT',
        description: params.description,
        paidAt: new Date(),
      });
      const savedTx = await txRepo.save(tx);

      return {
        creditBalance: Number(user.creditBalance),
        transaction: savedTx,
      };
    };

    if (params.manager) {
      return run(params.manager);
    }
    return this.dataSource.transaction(run);
  }

  async boostKost(userId: number, kostId: number, packageCode: string) {
    const basePkg = BOOST_PACKAGES[(packageCode || '').trim().toUpperCase()];
    if (!basePkg) {
      throw new BadRequestException('Paket boost iklan tidak valid.');
    }
    const cfg = await this.platformService?.getSettings().catch(() => null);
    const dynamicPrice =
      basePkg.code === 'BOOST_3D'
        ? (cfg?.boost3dPrice ?? basePkg.price)
        : basePkg.code === 'BOOST_7D'
          ? (cfg?.boost7dPrice ?? basePkg.price)
          : (cfg?.boost14dPrice ?? basePkg.price);
    const pkg = { ...basePkg, price: dynamicPrice };

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const kostRepo = manager.getRepository(Kost);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('Pengguna tidak ditemukan.');
      }
      this._assertEligibleUser(user);

      const kost = await kostRepo.findOne({
        where: { id: kostId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!kost) {
        throw new NotFoundException('Properti tidak ditemukan.');
      }
      if ((kost.approvalStatus || 'APPROVED').toUpperCase() !== 'APPROVED') {
        throw new BadRequestException(
          'Hanya properti yang sudah disetujui yang dapat di-boost.',
        );
      }

      const role = (user.role || '').trim().toUpperCase();
      const isPrivileged = role === 'ADMINISTRATOR' || role === 'STAFF';
      if (!isPrivileged && kost.ownerId !== userId) {
        throw new ForbiddenException(
          'Anda hanya dapat mempromosikan properti milik Anda sendiri.',
        );
      }

      let creditBalance = Number(user.creditBalance ?? 0);
      let transaction: WalletTransaction | null = null;
      if (!isPrivileged) {
        const deducted = await this.deductCredit({
          userId,
          amount: pkg.price,
          type: 'BOOST',
          description: `Boost Iklan ${pkg.label} — ${kost.name}`,
          manager,
        });
        creditBalance = deducted.creditBalance;
        transaction = deducted.transaction;
      }

      const now = new Date();
      const baseDate =
        kost.boostedUntil && kost.boostedUntil > now ? kost.boostedUntil : now;
      const nextUntil = new Date(
        baseDate.getTime() + pkg.days * 24 * 60 * 60 * 1000,
      );

      kost.boostedUntil = nextUntil;
      kost.boostTier = pkg.code;
      const savedKost = await kostRepo.save(kost);

      return {
        kost: savedKost,
        creditBalance,
        transaction,
      };
    });
  }

  async getWalletSummary(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }
    this._assertEligibleUser(user);

    let transactions = await this.walletRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 30,
    });

    const nowMs = Date.now();
    const stalePendingIds = transactions
      .filter(
        (tx) =>
          tx.type === 'TOPUP' &&
          tx.status === 'PENDING' &&
          nowMs - new Date(tx.createdAt).getTime() > 24 * 60 * 60 * 1000,
      )
      .map((tx) => tx.id);

    if (stalePendingIds.length > 0) {
      await this.walletRepo.update(
        { id: In(stalePendingIds) },
        { status: 'EXPIRED' },
      );
      transactions = transactions.map((tx) =>
        stalePendingIds.includes(tx.id) ? { ...tx, status: 'EXPIRED' } : tx,
      );
    }

    // Hanya sync transaksi PENDING yang baru dibuat (< 30 menit) sebagai jaring pengaman
    // jika user redirect sebelum webhook Midtrans tiba.
    const recentPendingTopups = transactions
      .filter(
        (tx) =>
          tx.type === 'TOPUP' &&
          tx.status === 'PENDING' &&
          Boolean(tx.orderId) &&
          nowMs - new Date(tx.createdAt).getTime() <= 30 * 60 * 1000,
      )
      .slice(0, 3);

    if (recentPendingTopups.length > 0 && (process.env.MIDTRANS_SERVER_KEY || '').trim()) {
      await Promise.allSettled(
        recentPendingTopups.map((tx) => this.syncTopupStatus(userId, tx.orderId)),
      );
      const refreshedUser = await this.userRepo.findOne({
        where: { id: userId },
      });
      transactions = await this.walletRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 30,
      });
      return {
        creditBalance: Number(refreshedUser?.creditBalance ?? user.creditBalance ?? 0),
        payoutBalance: Number(refreshedUser?.payoutBalance ?? user.payoutBalance ?? 0),
        transactions,
      };
    }

    return {
      creditBalance: Number(user.creditBalance ?? 0),
      payoutBalance: Number(user.payoutBalance ?? 0),
      transactions,
    };
  }

  async createTopup(userId: number, dto: CreateTopupDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }
    this._assertEligibleUser(user);

    const cfg = await this.platformService?.getSettings().catch(() => null);
    if (cfg && cfg.allowWalletTopup === false) {
      throw new ForbiddenException(
        'Top-up saldo kredit sedang dalam masa persiapan/maintenance dan belum dapat digunakan. Silakan coba lagi nanti.',
      );
    }

    // Anti-spam invoice Midtrans: batasi maksimal 3 transaksi top-up PENDING dalam 24 jam terakhir per user
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPendingCount = await this.walletRepo
      .createQueryBuilder('tx')
      .where(
        'tx.userId = :userId AND tx.type = :type AND tx.status = :status AND tx.createdAt >= :since',
        {
          userId,
          type: 'TOPUP',
          status: 'PENDING',
          since: since24h,
        },
      )
      .getCount();
    if (recentPendingCount >= 3) {
      throw new BadRequestException(
        'Anda masih memiliki 3 tagihan top-up yang menunggu pembayaran. Silakan selesaikan pembayaran yang ada terlebih dahulu.',
      );
    }

    const amount = Math.round(Number(dto.amount));
    const { serverKey, clientKey, snapUrl } = this.midtransConfig;
    const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const orderId = `KYL-TOPUP-${userId}-${Date.now()}-${randSuffix}`;

    const webBaseUrl = (
      process.env.WEB_URL ||
      process.env.FRONTEND_URL ||
      'https://keyloka.com'
    )
      .trim()
      .replace(/\/+$/, '');
    const snapPayload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      item_details: [
        {
          id: 'KEYLOKA-CREDIT',
          price: amount,
          quantity: 1,
          name: `Top Up Saldo Kredit Keyloka (${amount.toLocaleString('id-ID')})`,
        },
      ],
      customer_details: {
        first_name: user.name || 'Pemilik Kost',
        email: user.email || undefined,
        phone: user.phone || undefined,
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

    const tx = this.walletRepo.create({
      userId,
      orderId,
      amount,
      type: 'TOPUP',
      status: 'PENDING',
      snapToken: data.token,
      paymentUrl: data.redirect_url,
      paymentMethod: '',
      description: 'Top-up saldo kredit Keyloka',
    });

    const saved = await this.walletRepo.save(tx);

    return {
      orderId: saved.orderId,
      transaction: saved,
      snapToken: data.token,
      paymentUrl: data.redirect_url,
      clientKey,
    };
  }

  private _mapMidtransStatus(
    transactionStatus?: string,
    fraudStatus?: string,
  ): 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED' {
    const status = (transactionStatus || '').toLowerCase();
    const fraud = (fraudStatus || '').toLowerCase();
    if (status === 'settlement') return 'PAID';
    if (status === 'capture') {
      return fraud === 'challenge' ? 'PENDING' : 'PAID';
    }
    if (status === 'pending') return 'PENDING';
    if (status === 'expire') return 'EXPIRED';
    if (status === 'cancel' || status === 'deny' || status === 'failure') {
      return 'FAILED';
    }
    return 'PENDING';
  }

  private async _applyMidtransStatusUpdate(
    orderId: string,
    mappedStatus: 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED',
    paymentType?: string,
  ): Promise<{ transaction: WalletTransaction; creditBalance: number }> {
    let statusChangedTo: 'PAID' | 'PENDING' | 'EXPIRED' | 'FAILED' | null = null;

    const result = await this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(WalletTransaction);
      const userRepo = manager.getRepository(User);

      const tx = await txRepo.findOne({
        where: { orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tx) {
        throw new NotFoundException(`Transaksi ${orderId} tidak ditemukan.`);
      }

      const user = await userRepo.findOne({
        where: { id: tx.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('Pengguna tidak ditemukan.');
      }

      const prevStatus = tx.status;
      const wasPaid = prevStatus === 'PAID';
      if (!wasPaid) {
        tx.status = mappedStatus;
        if (paymentType) {
          tx.paymentMethod = paymentType;
        }
        if (mappedStatus === 'PAID') {
          tx.paidAt = new Date();
          user.creditBalance = Number(user.creditBalance ?? 0) + Number(tx.amount);
          await userRepo.save(user);
        }
        await txRepo.save(tx);
        if (prevStatus !== mappedStatus) {
          statusChangedTo = mappedStatus;
        }
      } else if (paymentType && !tx.paymentMethod) {
        tx.paymentMethod = paymentType;
        await txRepo.save(tx);
      }

      return {
        transaction: tx,
        creditBalance: Number(user.creditBalance ?? 0),
      };
    });

    if (statusChangedTo === 'PAID') {
      const amtStr = Number(result.transaction.amount).toLocaleString('id-ID');
      const balStr = result.creditBalance.toLocaleString('id-ID');
      await this.notificationsService
        .create({
          userId: result.transaction.userId,
          type: 'WALLET',
          title: 'Top-Up Saldo Kredit Berhasil',
          body: `Top-up saldo kredit sebesar Rp${amtStr} (${result.transaction.orderId}) telah diterima. Saldo kredit Anda sekarang Rp${balStr}.`,
          targetUrl: '/dashboard?tab=WALLET',
        })
        .catch((err) => {
          this.logger.warn(
            `Gagal menyimpan notifikasi top-up ${statusChangedTo} userId=${result.transaction.userId}: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        });
      const user = await this.userRepo.findOne({
        where: { id: result.transaction.userId },
      });
      if (user?.email) {
        void this.mailService?.sendEmail(user.email, {
          subject: `[Keyloka] Top-Up Saldo Kredit Rp${amtStr} Berhasil`,
          badgeText: 'Top-Up Berhasil',
          badgeTone: 'emerald',
          title: 'Top-Up Saldo Kredit Berhasil',
          greetingName: user.name,
          intro:
            'Pembayaran top-up saldo kredit iklan Anda telah kami terima dan saldo Anda langsung diperbarui.',
          details: [
            { label: 'Order ID', value: result.transaction.orderId },
            { label: 'Nominal Top-Up', value: `Rp${amtStr}` },
            { label: 'Saldo Kredit Terbaru', value: `Rp${balStr}` },
          ],
          ctaLabel: 'Buka Dompet & Saldo',
          ctaUrl: '/dashboard?tab=WALLET',
        });
      }
    } else if (statusChangedTo === 'FAILED' || statusChangedTo === 'EXPIRED') {
      const amtStr = Number(result.transaction.amount).toLocaleString('id-ID');
      await this.notificationsService
        .create({
          userId: result.transaction.userId,
          type: 'WALLET',
          title:
            statusChangedTo === 'FAILED'
              ? 'Pembayaran Top-Up Gagal'
              : 'Invoice Top-Up Kedaluwarsa',
          body:
            statusChangedTo === 'FAILED'
              ? `Pembayaran top-up saldo kredit sebesar Rp${amtStr} (${result.transaction.orderId}) gagal diproses.`
              : `Invoice top-up saldo kredit sebesar Rp${amtStr} (${result.transaction.orderId}) telah melewati batas waktu pembayaran.`,
          targetUrl: '/dashboard?tab=WALLET',
        })
        .catch((err) => {
          this.logger.warn(
            `Gagal menyimpan notifikasi top-up ${statusChangedTo} userId=${result.transaction.userId}: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        });
    }

    return result;
  }

  async syncTopupStatus(userId: number, orderId: string) {
    const existing = await this.walletRepo.findOne({ where: { orderId } });
    if (!existing) {
      throw new NotFoundException('Transaksi top-up tidak ditemukan.');
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException(
        'Anda tidak berhak memeriksa transaksi ini.',
      );
    }

    if (existing.status === 'PAID') {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      return {
        transaction: existing,
        creditBalance: Number(user?.creditBalance ?? 0),
      };
    }

    const { serverKey, statusBaseUrl } = this.midtransConfig;
    const response = await fetch(
      `${statusBaseUrl}/${encodeURIComponent(orderId)}/status`,
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
      payment_type?: string;
      status_message?: string;
    };

    if (response.status === 404 || data.status_code === '404') {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        return this._applyMidtransStatusUpdate(orderId, 'EXPIRED');
      }
      const user = await this.userRepo.findOne({ where: { id: userId } });
      return {
        transaction: existing,
        creditBalance: Number(user?.creditBalance ?? 0),
      };
    }

    if (!response.ok) {
      throw new BadRequestException(
        data.status_message || 'Gagal memeriksa status transaksi Midtrans.',
      );
    }

    const mapped = this._mapMidtransStatus(
      data.transaction_status,
      data.fraud_status,
    );
    if (mapped === 'PAID' && data.gross_amount) {
      const paidAmt = Math.round(Number(data.gross_amount));
      if (Number.isFinite(paidAmt) && paidAmt !== Number(existing.amount)) {
        throw new BadRequestException(
          'Nominal pembayaran Midtrans tidak sesuai dengan transaksi top-up.',
        );
      }
    }
    return this._applyMidtransStatusUpdate(orderId, mapped, data.payment_type);
  }

  async handleMidtransWebhook(payload: Record<string, unknown>) {
    const orderId = String(payload.order_id || '');
    const statusCode = String(payload.status_code || '');
    const grossAmount = String(payload.gross_amount || '');
    const signatureKey = String(payload.signature_key || '');

    if (!orderId || !statusCode || !grossAmount || !signatureKey) {
      throw new BadRequestException('Payload webhook Midtrans tidak lengkap.');
    }

    const { signatureKey: webhookSecretKey } = this.midtransConfig;
    const expectedSignature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${webhookSecretKey}`)
      .digest('hex');

    const normalizedSignature = signatureKey.trim().toLowerCase();
    const isValidSignature =
      expectedSignature.length === normalizedSignature.length &&
      crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(normalizedSignature, 'utf8'),
      );

    if (!isValidSignature) {
      throw new UnauthorizedException('Signature webhook Midtrans tidak valid.');
    }

    if (orderId.startsWith('payment_notif_test_')) {
      return { ok: true, test: true, orderId };
    }

    if (orderId.startsWith('KYL-BOOK-') || orderId.startsWith('HNV-BOOK-')) {
      const updatedBooking =
        await this.bookingsService.applyMidtransWebhookPayment(
          orderId,
          String(payload.transaction_status || ''),
          String(payload.fraud_status || ''),
          grossAmount,
        );
      return {
        ok: true,
        orderId,
        status: updatedBooking.status,
        paymentStatus: updatedBooking.paymentStatus,
      };
    }

    const mapped = this._mapMidtransStatus(
      String(payload.transaction_status || ''),
      String(payload.fraud_status || ''),
    );
    if (mapped === 'PAID') {
      const existingTx = await this.walletRepo.findOne({ where: { orderId } });
      const paidAmt = Math.round(Number(grossAmount));
      if (
        existingTx &&
        Number.isFinite(paidAmt) &&
        paidAmt !== Number(existingTx.amount)
      ) {
        throw new BadRequestException(
          'Nominal webhook Midtrans tidak sesuai dengan transaksi top-up.',
        );
      }
    }
    const paymentType = payload.payment_type
      ? String(payload.payment_type)
      : undefined;

    const result = await this._applyMidtransStatusUpdate(
      orderId,
      mapped,
      paymentType,
    );
    return {
      ok: true,
      orderId,
      status: result.transaction.status,
      creditBalance: result.creditBalance,
    };
  }

  async createPayoutRequest(
    userId: number,
    dto: {
      amount: number;
      bankName: string;
      accountNumber: string;
      accountHolder: string;
    },
  ) {
    const amount = Math.round(Number(dto.amount ?? 0));
    const bankName = (dto.bankName || '').trim();
    const accountNumber = (dto.accountNumber || '').trim();
    const accountHolder = (dto.accountHolder || '').trim();

    const cfg = await this.platformService?.getSettings().catch(() => null);
    const minWithdraw = cfg?.minWithdrawAmount ?? 10000;
    if (!Number.isFinite(amount) || amount < minWithdraw) {
      throw new BadRequestException(
        `Minimal penarikan dana adalah Rp${minWithdraw.toLocaleString('id-ID')}.`,
      );
    }
    if (!bankName || accountNumber.length < 5 || !accountHolder) {
      throw new BadRequestException(
        'Nama bank, nomor rekening, dan nama pemilik rekening wajib diisi lengkap.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const payoutRepo = manager.getRepository(PayoutRequest);

      const user = await userRepo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('Pengguna tidak ditemukan.');
      }
      this._assertEligibleUser(user);
      const userRole = (user.role || '').toUpperCase();
      const isUserVerified =
        Boolean(user.isVerified) ||
        userRole === 'STAFF' ||
        userRole === 'ADMINISTRATOR';
      if (!isUserVerified) {
        throw new ForbiddenException(
          'Akun Anda belum terverifikasi. Ajukan survei verifikasi di profil untuk membuka fitur Tarik Dana.',
        );
      }

      const currentPayout = Number(user.payoutBalance ?? 0);
      if (currentPayout < amount) {
        throw new BadRequestException(
          `Saldo pendapatan sewa tidak mencukupi (tersedia Rp${currentPayout.toLocaleString('id-ID')}).`,
        );
      }

      user.payoutBalance = currentPayout - amount;
      await userRepo.save(user);

      const req = payoutRepo.create({
        userId,
        amount,
        bankName,
        accountNumber,
        accountHolder,
        status: 'PENDING',
        adminNote: '',
      });
      const saved = await payoutRepo.save(req);

      return {
        request: saved,
        payoutBalance: Number(user.payoutBalance),
      };
    });
  }

  async getMyPayoutRequests(userId: number) {
    return this.payoutRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  async getAllPayoutRequests() {
    const requests = await this.payoutRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const userIds = Array.from(new Set(requests.map((r) => r.userId)));
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return requests.map((r) => ({
      ...r,
      ownerName: userMap.get(r.userId)?.name || 'Pemilik',
      ownerEmail: userMap.get(r.userId)?.email || '',
    }));
  }

  async processPayoutRequest(
    id: number,
    action: 'APPROVE' | 'REJECT',
    adminNote?: string,
    revisedAmount?: number,
  ) {
    const upperAction = (action || '').toUpperCase();
    if (upperAction !== 'APPROVE' && upperAction !== 'REJECT') {
      throw new BadRequestException('Aksi harus APPROVE atau REJECT.');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const payoutRepo = manager.getRepository(PayoutRequest);
      const userRepo = manager.getRepository(User);

      const req = await payoutRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!req) {
        throw new NotFoundException(`Pengajuan withdraw #${id} tidak ditemukan.`);
      }
      if (req.status !== 'PENDING') {
        throw new BadRequestException(
          `Pengajuan withdraw ini sudah diproses (${req.status}).`,
        );
      }

      if (upperAction === 'REJECT') {
        const user = await userRepo.findOne({
          where: { id: req.userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (user) {
          user.payoutBalance =
            Number(user.payoutBalance ?? 0) + Number(req.amount);
          await userRepo.save(user);
        }
        req.status = 'REJECTED';
      } else {
        if (revisedAmount !== undefined && revisedAmount !== null) {
          const parsed = Math.round(Number(revisedAmount));
          if (!Number.isFinite(parsed) || parsed < 10000) {
            throw new BadRequestException(
              'Nominal revisi minimal Rp10.000.',
            );
          }
          const diff = parsed - Number(req.amount);
          if (diff !== 0) {
            const user = await userRepo.findOne({
              where: { id: req.userId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!user) {
              throw new NotFoundException('Pemilik tidak ditemukan.');
            }
            if (diff > 0 && Number(user.payoutBalance ?? 0) < diff) {
              throw new BadRequestException(
                'Saldo pemilik tidak mencukupi untuk menaikkan nominal penarikan.',
              );
            }
            user.payoutBalance = Number(user.payoutBalance ?? 0) - diff;
            await userRepo.save(user);
            req.amount = parsed;
          }
        }
        req.status = 'APPROVED';
      }

      req.adminNote = (adminNote || '').trim();
      req.processedAt = new Date();
      return payoutRepo.save(req);
    });

    const amtStr = Number(saved.amount).toLocaleString('id-ID');
    const isApproved = saved.status === 'APPROVED';
    void this.platformService?.recordEvent({
      level: 'INFO',
      category: 'WALLET',
      actorUserId: saved.userId,
      message: `Pengajuan withdraw #${saved.id} Rp${amtStr} ${isApproved ? 'DISETUJUI' : 'DITOLAK'}`,
      meta: { payoutId: saved.id, amount: saved.amount, status: saved.status },
    });
    await this.notificationsService
      .create({
        userId: saved.userId,
        type: 'WALLET',
        title: isApproved
          ? 'Penarikan Dana Disetujui'
          : 'Penarikan Dana Ditolak',
        body: isApproved
          ? `Pengajuan penarikan dana sebesar Rp${amtStr} ke ${saved.bankName} (${saved.accountNumber}) telah disetujui.`
          : `Pengajuan penarikan dana sebesar Rp${amtStr} ditolak dan saldo telah dikembalikan ke dompet penghasilan Anda.`,
        targetUrl: '/dashboard?tab=WALLET',
      })
      .catch((err) => {
        this.logger.warn(
          `Gagal menyimpan notifikasi payout #${saved.id} userId=${saved.userId}: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      });

    const owner = await this.userRepo.findOne({ where: { id: saved.userId } });
    if (owner?.email) {
      void this.mailService?.sendEmail(owner.email, {
        subject: isApproved
          ? `[Keyloka] Penarikan Dana Rp${amtStr} Disetujui`
          : `[Keyloka] Penarikan Dana Rp${amtStr} Ditolak`,
        badgeText: isApproved ? 'Withdraw Disetujui' : 'Withdraw Ditolak',
        badgeTone: isApproved ? 'emerald' : 'red',
        title: isApproved
          ? 'Penarikan Dana Disetujui'
          : 'Penarikan Dana Ditolak',
        greetingName: owner.name,
        intro: isApproved
          ? 'Pengajuan penarikan dana penghasilan Anda telah disetujui dan diproses oleh tim Keyloka.'
          : 'Pengajuan penarikan dana Anda belum dapat disetujui dan saldo telah dikembalikan ke dompet penghasilan Anda.',
        details: [
          { label: 'Nominal', value: `Rp${amtStr}` },
          {
            label: 'Tujuan',
            value: `${saved.bankName} - ${saved.accountNumber} (${saved.accountHolder})`,
          },
          ...(saved.adminNote
            ? [{ label: 'Catatan Admin', value: saved.adminNote }]
            : []),
        ],
        ctaLabel: 'Lihat Riwayat Penarikan',
        ctaUrl: '/dashboard?tab=WALLET',
      });
    }

    return saved;
  }
}
