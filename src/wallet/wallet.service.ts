import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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
import { DuitkuService, DuitkuMappedStatus } from '../payments/duitku.service';

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
    private readonly duitkuService: DuitkuService,
  ) {}

  private _assertEligibleUser(user: User): void {
    const role = (user.role || '').trim().toUpperCase();
    if (!OWNER_ELIGIBLE_ROLES.has(role)) {
      throw new ForbiddenException(
        'Fitur top-up kredit hanya tersedia untuk akun Pemilik Kost, Staff, atau Administrator.',
      );
    }
  }

  getPricing() {
    return {
      freePropertyQuota: FREE_PROPERTY_QUOTA,
      extraPropertySlotFee: EXTRA_PROPERTY_SLOT_FEE,
      boostPackages: Object.values(BOOST_PACKAGES),
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
        orderId: `HNV-USE-${params.userId}-${Date.now()}-${randSuffix}`,
        amount: params.amount,
        type: params.type,
        status: 'PAID',
        paymentReference: null,
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
    const pkg = BOOST_PACKAGES[(packageCode || '').trim().toUpperCase()];
    if (!pkg) {
      throw new BadRequestException('Paket boost iklan tidak valid.');
    }

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

    const pendingTopups = transactions
      .filter(
        (tx) =>
          tx.type === 'TOPUP' && tx.status === 'PENDING' && Boolean(tx.orderId),
      )
      .slice(0, 5);

    if (pendingTopups.length > 0 && this.duitkuService.isConfigured()) {
      await Promise.allSettled(
        pendingTopups.map((tx) => this.syncTopupStatus(userId, tx.orderId)),
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

    const amount = Math.round(Number(dto.amount));
    const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const orderId = `HNV-TOPUP-${userId}-${Date.now()}-${randSuffix}`;

    const webBaseUrl = (
      process.env.WEB_URL ||
      process.env.FRONTEND_URL ||
      'https://keyloka.com'
    )
      .trim()
      .replace(/\/+$/, '');
    const apiBaseUrl = (
      process.env.API_PUBLIC_URL ||
      'https://api.keyloka.com'
    )
      .trim()
      .replace(/\/+$/, '');
    const callbackUrl = (
      process.env.DUITKU_CALLBACK_URL ||
      `${apiBaseUrl}/api/wallet/duitku-callback`
    ).trim();

    const invoice = await this.duitkuService.createInvoice({
      merchantOrderId: orderId,
      amount,
      productDetails: `Top Up Saldo Kredit Keyloka (${amount.toLocaleString('id-ID')})`,
      customerName: user.name || 'Pemilik Kost',
      customerEmail: user.email,
      customerPhone: user.phone,
      callbackUrl,
      returnUrl: `${webBaseUrl}/payment/finish`,
      itemDetails: [
        {
          name: `Top Up Saldo Kredit Keyloka (${amount.toLocaleString('id-ID')})`,
          price: amount,
          quantity: 1,
        },
      ],
    });

    const tx = this.walletRepo.create({
      userId,
      orderId,
      amount,
      type: 'TOPUP',
      status: 'PENDING',
      paymentReference: invoice.reference,
      paymentUrl: invoice.paymentUrl,
      paymentMethod: '',
      description: 'Top-up saldo kredit Keyloka',
    });

    const saved = await this.walletRepo.save(tx);

    return {
      transaction: saved,
      paymentReference: invoice.reference,
      paymentUrl: invoice.paymentUrl,
    };
  }

  private async _applyPaymentStatusUpdate(
    orderId: string,
    mappedStatus: DuitkuMappedStatus,
    paymentType?: string,
  ): Promise<{ transaction: WalletTransaction; creditBalance: number }> {
    return this.dataSource.transaction(async (manager) => {
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

      const wasPaid = tx.status === 'PAID';
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
      } else if (paymentType && !tx.paymentMethod) {
        tx.paymentMethod = paymentType;
        await txRepo.save(tx);
      }

      return {
        transaction: tx,
        creditBalance: Number(user.creditBalance ?? 0),
      };
    });
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

    const statusResult = await this.duitkuService.checkTransactionStatus(orderId);

    if (statusResult.notFound) {
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        return this._applyPaymentStatusUpdate(orderId, 'EXPIRED');
      }
      const user = await this.userRepo.findOne({ where: { id: userId } });
      return {
        transaction: existing,
        creditBalance: Number(user?.creditBalance ?? 0),
      };
    }

    if (
      statusResult.mappedStatus === 'PAID' &&
      statusResult.amount !== undefined &&
      statusResult.amount !== Number(existing.amount)
    ) {
      throw new BadRequestException(
        'Nominal pembayaran Duitku tidak sesuai dengan transaksi top-up.',
      );
    }
    return this._applyPaymentStatusUpdate(
      orderId,
      statusResult.mappedStatus,
    );
  }

  async handleDuitkuCallback(payload: Record<string, unknown>) {
    const merchantCode = String(payload.merchantCode || '');
    const amount = String(payload.amount || '');
    const orderId = String(payload.merchantOrderId || '');
    const resultCode = String(payload.resultCode || '');
    const signature = String(payload.signature || '');
    const paymentMethod = payload.paymentCode
      ? String(payload.paymentCode)
      : undefined;

    if (!merchantCode || !amount || !orderId || !signature) {
      throw new BadRequestException('Payload callback Duitku tidak lengkap.');
    }

    const isValid = this.duitkuService.verifyCallbackSignature({
      merchantCode,
      amount,
      merchantOrderId: orderId,
      signature,
    });
    if (!isValid) {
      throw new UnauthorizedException('Signature callback Duitku tidak valid.');
    }

    if (orderId.startsWith('HNV-BOOK-')) {
      const updatedBooking =
        await this.bookingsService.applyDuitkuCallbackPayment(
          orderId,
          resultCode,
          amount,
        );
      return {
        ok: true,
        orderId,
        status: updatedBooking.status,
        paymentStatus: updatedBooking.paymentStatus,
      };
    }

    const mapped = this.duitkuService.mapResultCode(resultCode);
    if (mapped === 'PAID') {
      const existingTx = await this.walletRepo.findOne({ where: { orderId } });
      const paidAmt = Math.round(Number(amount));
      if (
        existingTx &&
        Number.isFinite(paidAmt) &&
        paidAmt !== Number(existingTx.amount)
      ) {
        throw new BadRequestException(
          'Nominal callback Duitku tidak sesuai dengan transaksi top-up.',
        );
      }
    }

    const result = await this._applyPaymentStatusUpdate(
      orderId,
      mapped,
      paymentMethod,
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

    if (!Number.isFinite(amount) || amount < 10000) {
      throw new BadRequestException('Minimal penarikan dana adalah Rp10.000.');
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

    return this.dataSource.transaction(async (manager) => {
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
  }
}
