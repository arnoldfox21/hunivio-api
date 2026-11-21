import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Kost } from './entities/kost.entity';
import { KostReport } from './entities/kost-report.entity';
import { KostDailyStat } from './entities/kost-daily-stat.entity';
import { Facility } from './entities/facility.entity';
import { UserFavorite } from './entities/user-favorite.entity';
import { User } from '../users/entities/user.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { CreateKostDto } from './dto/create-kost.dto';
import { UpdateKostDto } from './dto/update-kost.dto';
import { FirebaseNotificationService } from '../chats/firebase-notification.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toTitleCaseRegion } from '../common/region-format.util';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { PlatformService } from '../platform/platform.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import {
  EXTRA_PROPERTY_SLOT_FEE,
  FREE_PROPERTY_QUOTA,
  WalletService,
} from '../wallet/wallet.service';

@Injectable()
export class KostsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KostsService.name);
  private readonly _engagementDedupe = new Map<string, number>();
  private readonly _pendingMetrics = new Map<
    string,
    { kostId: number; date: string; views: number; waClicks: number }
  >();
  private _metricsFlushTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
    @InjectRepository(KostReport)
    private readonly kostReportRepository: Repository<KostReport>,
    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,
    @InjectRepository(UserFavorite)
    private readonly favoriteRepository: Repository<UserFavorite>,
    @InjectRepository(KostDailyStat)
    private readonly dailyStatRepository: Repository<KostDailyStat>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly firebaseNotificationService: FirebaseNotificationService,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly platformService?: PlatformService,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE kosts ADD COLUMN IF NOT EXISTS "viewCount" integer NOT NULL DEFAULT 0;
      ALTER TABLE kosts ADD COLUMN IF NOT EXISTS "waClickCount" integer NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS kost_daily_stats (
        id SERIAL PRIMARY KEY,
        "kostId" integer NOT NULL,
        date varchar(10) NOT NULL,
        views integer NOT NULL DEFAULT 0,
        "waClicks" integer NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_kost_daily_stats_kostId_date" UNIQUE ("kostId", date)
      );
      CREATE INDEX IF NOT EXISTS "IDX_kost_daily_stats_kostId" ON kost_daily_stats ("kostId");
      CREATE INDEX IF NOT EXISTS "IDX_kost_daily_stats_date" ON kost_daily_stats (date);
    `);
    await this.cleanBrandNamesInDb();
    if (process.env.ENABLE_AUTO_SEED === 'true') {
      await this.seedFacilitiesIfNeeded();
    }
    this._metricsFlushTimer = setInterval(() => {
      this._flushPendingMetrics().catch((err) => {
        this.logger.warn(
          `Gagal flush metrik kunjungan properti: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, 15_000);
    this._metricsFlushTimer.unref();
  }

  async onModuleDestroy() {
    if (this._metricsFlushTimer) {
      clearInterval(this._metricsFlushTimer);
      this._metricsFlushTimer = null;
    }
    await this._flushPendingMetrics().catch(() => undefined);
  }

  private async seedFacilitiesIfNeeded() {
    const roomDefaults = [
      'AC',
      'Kipas Angin',
      'WiFi',
      'Kasur',
      'Bantal & Guling',
      'Sprei',
      'Lemari Baju',
      'Meja Belajar',
      'Kursi',
      'Cermin',
      'Kamar Mandi Dalam',
      'Kamar Mandi Luar',
      'Kloset Duduk',
      'Kloset Jongkok',
      'Shower',
      'Water Heater',
      'TV',
      'Kulkas Mini',
      'Jendela',
      'Balkon',
    ];
    const publicDefaults = [
      'WiFi Umum',
      'Parkir Motor',
      'Parkir Mobil',
      'Parkir Sepeda',
      'Dapur Bersama',
      'Kompor & Gas',
      'Kulkas',
      'Dispenser',
      'Mesin Cuci',
      'Jemuran',
      'Ruang Tamu',
      'Ruang Santai',
      'Mushola',
      'CCTV',
      'Penjaga Kost',
      'Security 24 Jam',
      'Akses 24 Jam',
      'Laundry',
      'Kolam Renang',
      'Gym / Fitness',
      'Taman',
      'Free Listrik',
      'Free Air',
    ];

    const existing = await this.facilityRepository.find();
    const existingNames = new Set(existing.map((f) => f.name.toLowerCase()));
    const toInsert: Facility[] = [];

    for (const name of roomDefaults) {
      if (!existingNames.has(name.toLowerCase())) {
        toInsert.push(
          this.facilityRepository.create({
            name,
            category: 'ROOM',
            isActive: true,
          }),
        );
        existingNames.add(name.toLowerCase());
      }
    }
    for (const name of publicDefaults) {
      if (!existingNames.has(name.toLowerCase())) {
        toInsert.push(
          this.facilityRepository.create({
            name,
            category: 'PUBLIC',
            isActive: true,
          }),
        );
        existingNames.add(name.toLowerCase());
      }
    }

    if (toInsert.length > 0) {
      await this.facilityRepository.save(toInsert);
    }
  }

  private getFacilityPresetsByCategory(category?: string, unitType?: string): {
    roomFacilities: string[];
    publicFacilities: string[];
  } | null {
    const cat = (category || '').trim().toUpperCase();
    const sub = (unitType || '').trim().toLowerCase();

    if (cat === 'KONTRAKAN') {
      return {
        roomFacilities: [
          'Kamar Tidur',
          'Ruang Tamu',
          'Ruang Keluarga',
          'Dapur Pribadi',
          'Kamar Mandi',
          'Shower',
          'Kloset Duduk',
          'Kloset Jongkok',
          'AC',
          'Water Heater',
          'Teras / Halaman',
          'Toren & Pompa Air',
          'Listrik Token',
          'PDAM / Air Sumur',
        ],
        publicFacilities: [
          'Carport / Garasi',
          'Parkir Motor',
          'Parkir Mobil',
          'Akses Jalan Mobil',
          'Keamanan 24 Jam / One Gate',
          'CCTV Lingkungan',
          'Dekat Masjid / Mushola',
          'Bebas Banjir',
          'Taman',
        ],
      };
    }

    if (cat === 'HUNIAN_HARIAN') {
      if (sub === 'homestay') {
        return {
          roomFacilities: [
            'AC',
            'Kipas Angin',
            'WiFi',
            'TV',
            'Kasur Nyaman',
            'Kamar Mandi Dalam',
            'Shower',
            'Water Heater',
            'Handuk & Perlengkapan Mandi',
            'Meja & Kursi',
            'Lemari',
            'Balkon / Teras',
          ],
          publicFacilities: [
            'Sarapan',
            'Ruang Tamu Bersama',
            'Pantry / Dapur Bersama',
            'Dispenser / Air Mineral',
            'Parkir Motor',
            'Parkir Mobil',
            'Check-in 24 Jam',
            'Laundry',
            'CCTV',
          ],
        };
      }
      // Default HUNIAN_HARIAN -> Villa
      return {
        roomFacilities: [
          'Private Pool',
          'AC',
          'WiFi',
          'Smart TV / Karaoke',
          'Kitchen Set Lengkap',
          'Kulkas',
          'Dispenser',
          'Ruang Keluarga',
          'Water Heater',
          'Bathtub',
          'Balkon / Rooftop',
          'View Alam',
          'Handuk & Amenities',
        ],
        publicFacilities: [
          'Area BBQ',
          'Taman Pribadi',
          'Parkir Mobil Luas',
          'Carport / Garasi',
          'Sarapan (Opsional)',
          'Penjaga / Caretaker 24 Jam',
          'CCTV',
          'Free Listrik & Air',
        ],
      };
    }

    return null;
  }

  async getMasterFacilities(category?: string, unitType?: string) {
    const preset = this.getFacilityPresetsByCategory(category, unitType);
    if (preset) {
      return preset;
    }
    const all = await this.facilityRepository.find({
      where: { isActive: true },
      order: { id: 'ASC' },
    });
    return {
      roomFacilities: all
        .filter((f) => f.category === 'ROOM')
        .map((f) => f.name),
      publicFacilities: all
        .filter((f) => f.category === 'PUBLIC')
        .map((f) => f.name),
    };
  }

  private async cleanBrandNamesInDb() {
    const kosts = await this.kostRepository.find();
    for (const k of kosts) {
      let updated = false;
      const cleanedName = k.name
        .replace(/\bSinggahsini\s+/gi, '')
        .replace(/\bApik\s+/gi, '');
      const cleanedSlug = k.slug
        .replace(/singgahsini-/gi, '')
        .replace(/apik-/gi, '');
      const cleanedOwner = k.ownerName.replace(/Singgahsini/gi, 'Kost');
      if (cleanedName !== k.name) {
        k.name = cleanedName;
        updated = true;
      }
      if (cleanedSlug !== k.slug) {
        k.slug = cleanedSlug;
        updated = true;
      }
      if (cleanedOwner !== k.ownerName) {
        k.ownerName = cleanedOwner;
        updated = true;
      }
      const formattedCity = toTitleCaseRegion(k.city);
      if (formattedCity && formattedCity !== k.city) {
        k.city = formattedCity;
        updated = true;
      }
      const formattedDistrict = toTitleCaseRegion(k.district);
      if (formattedDistrict && formattedDistrict !== k.district) {
        k.district = formattedDistrict;
        updated = true;
      }
      if (updated) {
        await this.kostRepository.save(k);
      }
    }
  }

  async findAll(query: {
    search?: string;
    propertyCategory?: string;
    unitType?: string;
    type?: string;
    city?: string;
    district?: string;
    facility?: string;
    minPrice?: string;
    maxPrice?: string;
    onlyAvailable?: string;
    onlyFavorite?: string;
    sortBy?: string;
    ownerId?: string;
    includePending?: string;
    approvalStatus?: string;
    page?: string;
    limit?: string;
    viewerId?: number;
  }): Promise<any> {
    const qb = this.kostRepository.createQueryBuilder('kost');

    if (query.ownerId) {
      const oid = parseInt(query.ownerId, 10);
      if (!isNaN(oid)) {
        qb.andWhere('kost.ownerId = :oid', { oid });
      }
    }

    if (query.approvalStatus && query.approvalStatus.toUpperCase() !== 'ALL') {
      qb.andWhere('UPPER(kost.approvalStatus) = UPPER(:approvalStatus)', {
        approvalStatus: query.approvalStatus.trim(),
      });
    } else if (query.includePending !== 'true' && !query.ownerId) {
      qb.andWhere('kost.approvalStatus = :approvedStatus', {
        approvedStatus: 'APPROVED',
      });
    }

    if (query.propertyCategory && query.propertyCategory !== 'SEMUA') {
      const cat = query.propertyCategory.trim().toUpperCase();
      if (cat === 'LONG_TERM') {
        qb.andWhere('UPPER(kost.propertyCategory) IN (:...longTermCats)', {
          longTermCats: ['KOST', 'APARTEMEN', 'KONTRAKAN'],
        });
      } else {
        qb.andWhere('UPPER(kost.propertyCategory) = UPPER(:cat)', {
          cat,
        });
      }
    }

    if (query.unitType && query.unitType !== 'Semua') {
      qb.andWhere('LOWER(kost.unitType) = LOWER(:unitType)', {
        unitType: query.unitType.trim(),
      });
    }

    if (query.onlyAvailable === 'true') {
      qb.andWhere('kost.availableRooms > 0');
    }

    if (query.onlyFavorite === 'true') {
      if (!query.viewerId) {
        if (query.page || query.limit) {
          const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
          const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
          return { data: [], total: 0, page, limit, hasMore: false };
        }
        return [];
      }
      const favs = await this.favoriteRepository.find({
        where: { userId: query.viewerId },
      });
      const favIds = favs.map((f) => f.kostId);
      if (favIds.length === 0) {
        if (query.page || query.limit) {
          const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
          const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
          return { data: [], total: 0, page, limit, hasMore: false };
        }
        return [];
      }
      qb.andWhere('kost.id IN (:...favIds)', { favIds });
    }

    if (query.search && query.search.trim() !== '') {
      const s = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(kost.name) LIKE :s OR LOWER(kost.city) LIKE :s OR LOWER(kost.district) LIKE :s OR LOWER(kost.address) LIKE :s OR LOWER(kost.nearbyLandmark) LIKE :s)',
        { s },
      );
    }

    if (query.type && query.type !== 'Semua') {
      qb.andWhere('LOWER(kost.type) = LOWER(:type)', { type: query.type });
    }

    if (query.city && query.city !== 'Semua Kota') {
      qb.andWhere('LOWER(kost.city) = LOWER(:city)', { city: query.city });
    }

    if (query.district && query.district !== 'Semua Area') {
      qb.andWhere('LOWER(kost.district) = LOWER(:district)', {
        district: query.district,
      });
    }

    const effectivePriceExpr =
      "CASE WHEN UPPER(kost.propertyCategory) = 'HUNIAN_HARIAN' THEN COALESCE(NULLIF(kost.pricePerDay, 0), kost.pricePerMonth) WHEN UPPER(kost.propertyCategory) = 'KONTRAKAN' THEN COALESCE(NULLIF(kost.pricePerYear, 0), kost.pricePerMonth) ELSE kost.pricePerMonth END";

    if (query.minPrice) {
      const min = parseInt(query.minPrice, 10);
      if (!isNaN(min)) {
        qb.andWhere(`${effectivePriceExpr} >= :min`, { min });
      }
    }

    if (query.maxPrice) {
      const max = parseInt(query.maxPrice, 10);
      if (!isNaN(max)) {
        qb.andWhere(`${effectivePriceExpr} <= :max`, { max });
      }
    }

    if (query.facility && query.facility.trim() !== '') {
      qb.andWhere(
        'kost.roomFacilities::text ILIKE :fac OR kost.publicFacilities::text ILIKE :fac',
        {
          fac: `%${query.facility.trim()}%`,
        },
      );
    }

    switch (query.sortBy) {
      case 'price_asc':
        qb.addSelect(effectivePriceExpr, 'effective_price')
          .orderBy('effective_price', 'ASC');
        break;
      case 'price_desc':
        qb.addSelect(effectivePriceExpr, 'effective_price')
          .orderBy('effective_price', 'DESC');
        break;
      case 'rating_desc':
        qb.orderBy('kost.rating', 'DESC').addOrderBy('kost.reviewCount', 'DESC');
        break;
      case 'newest':
        qb.orderBy('kost.createdAt', 'DESC');
        break;
      default: {
        const recommendationScoreExpr =
          '(COALESCE(kost.rating, 0) * LN(GREATEST(COALESCE(kost.reviewCount, 0), 0) + 2))' +
          ' + (CASE WHEN kost.discountPercent > 0 THEN 1.5 ELSE 0 END)' +
          ' + (CASE WHEN jsonb_array_length(kost.images) > 0 THEN 1.0 ELSE 0 END)' +
          ' + (CASE WHEN kost.latitude IS NOT NULL AND kost.longitude IS NOT NULL THEN 0.5 ELSE 0 END)' +
          " + (CASE WHEN kost.createdAt >= NOW() - INTERVAL '14 days' THEN 1.0 ELSE 0 END)";
        qb.addSelect(
          'CASE WHEN kost.boostedUntil IS NOT NULL AND kost.boostedUntil > NOW() THEN 1 ELSE 0 END',
          'is_boosted',
        )
          .addSelect(
            'CASE WHEN kost.availableRooms > 0 THEN 1 ELSE 0 END',
            'has_rooms',
          )
          .addSelect(recommendationScoreExpr, 'recommendation_score')
          .orderBy('is_boosted', 'DESC')
          .addOrderBy('kost.boostedUntil', 'DESC', 'NULLS LAST')
          .addOrderBy('has_rooms', 'DESC')
          .addOrderBy('recommendation_score', 'DESC');
        break;
      }
    }

    if (query.page || query.limit) {
      const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
      const [data, total] = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();
      await this.syncOwnerNames(data);
      await this.attachUserFavorites(data, query.viewerId);
      return {
        data,
        total,
        page,
        limit,
        hasMore: page * limit < total,
      };
    }

    const list = await qb.getMany();
    await this.syncOwnerNames(list);
    return this.attachUserFavorites(list, query.viewerId);
  }

  private async attachUserFavorites(
    kosts: Kost[],
    viewerId?: number,
  ): Promise<Kost[]> {
    if (kosts.length === 0) return kosts;
    if (!viewerId) {
      for (const k of kosts) {
        k.isFavorite = false;
      }
      return kosts;
    }
    const kostIds = kosts.map((k) => k.id);
    const favs = await this.favoriteRepository.find({
      where: { userId: viewerId, kostId: In(kostIds) },
    });
    const favSet = new Set(favs.map((f) => f.kostId));
    for (const k of kosts) {
      k.isFavorite = favSet.has(k.id);
    }
    return kosts;
  }

  private normalizeKostImages(kosts: Kost[]): void {
    for (const k of kosts) {
      if (Array.isArray(k.images)) {
        k.images = k.images.map((img) =>
          this.storageService.resolvePublicUrl(img),
        );
      }
    }
  }

  async syncOwnerNames(kosts: Kost[]): Promise<Kost[]> {
    if (kosts.length === 0) return kosts;
    this.normalizeKostImages(kosts);
    const ownerIds = Array.from(
      new Set(kosts.map((k) => k.ownerId).filter((id) => id > 0)),
    );
    if (ownerIds.length === 0) return kosts;
    const owners = await this.userRepository.find({
      where: { id: In(ownerIds) },
    });
    const ownerMap = new Map(owners.map((u) => [u.id, u]));
    for (const k of kosts) {
      const owner = ownerMap.get(k.ownerId);
      if (owner && owner.name && owner.name.trim().length > 0) {
        k.ownerName = owner.name.trim();
        if ((!k.ownerPhone || !k.ownerPhone.trim()) && owner.phone && owner.phone.trim()) {
          k.ownerPhone = owner.phone.trim();
        }
      }
      (k as Kost & { showOwnerWhatsapp?: boolean }).showOwnerWhatsapp = Boolean(
        owner?.showWhatsapp,
      );
      const ownerRole = (owner?.role || '').toUpperCase();
      const isStaffPosted =
        ownerRole === 'STAFF' || ownerRole === 'ADMINISTRATOR';
      (k as Kost & { isStaffPosted?: boolean; staffWhatsapp?: string }).isStaffPosted =
        isStaffPosted;
      if (isStaffPosted && owner?.phone && owner.phone.trim()) {
        (k as Kost & { staffWhatsapp?: string }).staffWhatsapp = owner.phone.trim();
      }
      k.isVerified =
        Boolean(owner?.isVerified) ||
        ownerRole === 'STAFF' ||
        ownerRole === 'ADMINISTRATOR';
    }
    return kosts;
  }

  async getMapPoints(query: {
    propertyCategory?: string;
    unitType?: string;
    type?: string;
    city?: string;
    district?: string;
  }) {
    const qb = this.kostRepository
      .createQueryBuilder('kost')
      .select([
        'kost.id',
        'kost.name',
        'kost.propertyCategory',
        'kost.unitType',
        'kost.type',
        'kost.city',
        'kost.district',
        'kost.pricePerMonth',
        'kost.pricePerDay',
        'kost.rating',
        'kost.reviewCount',
        'kost.availableRooms',
        'kost.latitude',
        'kost.longitude',
        'kost.images',
        'kost.nearbyLandmark',
        'kost.ownerId',
        'kost.ownerName',
        'kost.ownerPhone',
        'kost.isVerified',
        'kost.isSinggahsini',
      ])
      .where('kost.latitude IS NOT NULL AND kost.longitude IS NOT NULL')
      .andWhere('kost.approvalStatus = :approvedStatus', {
        approvedStatus: 'APPROVED',
      });

    if (query.propertyCategory && query.propertyCategory !== 'SEMUA') {
      const cat = query.propertyCategory.trim().toUpperCase();
      if (cat === 'LONG_TERM') {
        qb.andWhere('UPPER(kost.propertyCategory) IN (:...longTermCats)', {
          longTermCats: ['KOST', 'APARTEMEN', 'KONTRAKAN'],
        });
      } else {
        qb.andWhere('UPPER(kost.propertyCategory) = UPPER(:cat)', {
          cat,
        });
      }
    }

    if (query.unitType && query.unitType !== 'Semua') {
      qb.andWhere('LOWER(kost.unitType) = LOWER(:unitType)', {
        unitType: query.unitType.trim(),
      });
    }
    if (query.type && query.type !== 'Semua') {
      qb.andWhere('LOWER(kost.type) = LOWER(:type)', { type: query.type });
    }
    if (query.city && query.city !== 'Semua Kota') {
      qb.andWhere('LOWER(kost.city) = LOWER(:city)', { city: query.city });
    }

    if (query.district && query.district !== 'Semua Area') {
      qb.andWhere('LOWER(kost.district) = LOWER(:district)', {
        district: query.district,
      });
    }
    const list = await qb.getMany();
    return this.syncOwnerNames(list);
  }

  private applyCategoryFilter(
    qb: ReturnType<Repository<Kost>['createQueryBuilder']>,
    propertyCategory?: string,
  ) {
    if (!propertyCategory || propertyCategory === 'SEMUA') return;
    const cat = propertyCategory.trim().toUpperCase();
    if (cat === 'LONG_TERM') {
      qb.andWhere('UPPER(kost.propertyCategory) IN (:...longTermCats)', {
        longTermCats: ['KOST', 'APARTEMEN', 'KONTRAKAN'],
      });
    } else {
      qb.andWhere('UPPER(kost.propertyCategory) = UPPER(:cat)', { cat });
    }
  }

  async getCities(propertyCategory?: string) {
    const qb = this.kostRepository
      .createQueryBuilder('kost')
      .select('kost.city', 'city')
      .addSelect('COUNT(kost.id)', 'count')
      .where('kost.approvalStatus = :approvedStatus', {
        approvedStatus: 'APPROVED',
      });
    this.applyCategoryFilter(qb, propertyCategory);
    const raw = await qb
      .groupBy('kost.city')
      .orderBy('COUNT(kost.id)', 'DESC')
      .getRawMany();
    const map = new Map<string, { city: string; count: number }>();
    for (const r of raw) {
      const formatted = toTitleCaseRegion(r.city);
      if (!formatted) continue;
      const key = formatted.toLowerCase();
      const prev = map.get(key);
      if (prev) {
        prev.count += Number(r.count);
      } else {
        map.set(key, { city: formatted, count: Number(r.count) });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  private _filtersCache = new Map<
    string,
    {
      expiresAt: number;
      data: {
        cities: string[];
        types: string[];
        facilities: string[];
        cityStats: Array<{
          city: string;
          count: number;
          districts: Array<{ district: string; count: number }>;
        }>;
      };
    }
  >();

  async getFilters(propertyCategory?: string) {
    const cacheKey = (propertyCategory || 'SEMUA').trim().toUpperCase();
    const cached = this._filtersCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const qb = this.kostRepository
      .createQueryBuilder('kost')
      .select([
        'kost.city',
        'kost.district',
        'kost.type',
        'kost.roomFacilities',
        'kost.publicFacilities',
      ])
      .where('kost.approvalStatus = :status', { status: 'APPROVED' });
    this.applyCategoryFilter(qb, propertyCategory);
    const allKosts = await qb.getMany();
    const cityCounts = new Map<string, { label: string; count: number }>();
    const cityDistrictCounts = new Map<
      string,
      Map<string, { label: string; count: number }>
    >();
    const typesSet = new Set<string>();
    const facilitiesCount = new Map<string, number>();

    for (const k of allKosts) {
      const formattedCity = toTitleCaseRegion(k.city);
      if (formattedCity) {
        const cityKey = formattedCity.toLowerCase();
        const existingCity = cityCounts.get(cityKey);
        if (existingCity) {
          existingCity.count += 1;
        } else {
          cityCounts.set(cityKey, { label: formattedCity, count: 1 });
        }

        const formattedDistrict = toTitleCaseRegion(k.district);
        if (formattedDistrict) {
          let distMap = cityDistrictCounts.get(cityKey);
          if (!distMap) {
            distMap = new Map<string, { label: string; count: number }>();
            cityDistrictCounts.set(cityKey, distMap);
          }
          const distKey = formattedDistrict.toLowerCase();
          const existingDist = distMap.get(distKey);
          if (existingDist) {
            existingDist.count += 1;
          } else {
            distMap.set(distKey, { label: formattedDistrict, count: 1 });
          }
        }
      }
      if (k.type) {
        typesSet.add(k.type);
      }
      for (const f of [
        ...(k.roomFacilities || []),
        ...(k.publicFacilities || []),
      ]) {
        if (f) {
          facilitiesCount.set(f, (facilitiesCount.get(f) || 0) + 1);
        }
      }
    }

    const sortedCities = Array.from(cityCounts.entries()).sort(
      (a, b) => b[1].count - a[1].count,
    );
    const cities = sortedCities.map(([, val]) => val.label);

    const cityStats = sortedCities.map(([cityKey, val]) => {
      const distMap =
        cityDistrictCounts.get(cityKey) ||
        new Map<string, { label: string; count: number }>();
      const districts = Array.from(distMap.values())
        .sort((a, b) => b.count - a.count)
        .map((d) => ({ district: d.label, count: d.count }));
      return { city: val.label, count: val.count, districts };
    });

    const types = Array.from(typesSet);

    const facilities = Array.from(facilitiesCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([fac]) => fac);

    const result = {
      cities,
      types,
      facilities,
      cityStats,
    };
    this._filtersCache.set(cacheKey, {
      expiresAt: Date.now() + 60_000,
      data: result,
    });
    return result;
  }

  async toggleFavorite(id: number, userId: number): Promise<Kost> {
    const kost = await this.findOne(id, userId);
    const existing = await this.favoriteRepository.findOne({
      where: { userId, kostId: id },
    });
    if (existing) {
      await this.favoriteRepository.remove(existing);
      kost.isFavorite = false;
    } else {
      await this.favoriteRepository.save(
        this.favoriteRepository.create({ userId, kostId: id }),
      );
      kost.isFavorite = true;
    }
    return kost;
  }

  async findOne(id: number, viewerId?: number): Promise<Kost> {
    const kost = await this.kostRepository.findOne({ where: { id } });
    if (!kost) {
      throw new NotFoundException(`Kost dengan ID ${id} tidak ditemukan`);
    }
    await this.syncOwnerNames([kost]);
    await this.attachUserFavorites([kost], viewerId);
    return kost;
  }

  private validateCategoryPricing(params: {
    category?: string;
    pricePerMonth?: number | null;
    pricePerDay?: number | null;
    pricePerYear?: number | null;
  }) {
    const cat = (params.category || 'KOST').trim().toUpperCase();
    if (cat === 'HUNIAN_HARIAN') {
      if (!params.pricePerDay || params.pricePerDay <= 0) {
        throw new BadRequestException(
          'Harga per malam wajib diisi untuk kategori Hunian Harian.',
        );
      }
      return;
    }
    if (cat === 'KONTRAKAN') {
      if (!params.pricePerYear || params.pricePerYear <= 0) {
        throw new BadRequestException(
          'Harga per tahun wajib diisi untuk kategori Kontrakan.',
        );
      }
      return;
    }
    if (!params.pricePerMonth || params.pricePerMonth <= 0) {
      throw new BadRequestException(
        'Harga per bulan wajib diisi untuk kategori Kost / Apartemen.',
      );
    }
  }

  async create(dto: CreateKostDto): Promise<Kost> {
    const category = (dto.propertyCategory || 'KOST').trim().toUpperCase();
    this.validateCategoryPricing({
      category,
      pricePerMonth: dto.pricePerMonth,
      pricePerDay: dto.pricePerDay,
      pricePerYear: dto.pricePerYear,
    });
    const slug =
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Date.now().toString().slice(-4);
    const ownerId = dto.ownerId ?? 1;
    const creator = await this.userRepository.findOne({ where: { id: ownerId } });
    const creatorRole = (creator?.role || '').toUpperCase();
    const isStaffOrAdmin =
      creatorRole === 'ADMINISTRATOR' || creatorRole === 'STAFF';
    const isAutoApproved = isStaffOrAdmin || Boolean(creator?.isVerified);

    const cfg = await this.platformService?.getSettings().catch(() => null);
    const freeQuota = cfg?.freePropertyQuota ?? FREE_PROPERTY_QUOTA;
    const slotFee = cfg?.extraPropertySlotFee ?? EXTRA_PROPERTY_SLOT_FEE;

    return this.dataSource.transaction(async (manager) => {
      const kostRepo = manager.getRepository(Kost);
      const existingCount = await kostRepo.count({ where: { ownerId } });

      if (!isStaffOrAdmin && existingCount >= freeQuota) {
        await this.walletService.deductCredit({
          userId: ownerId,
          amount: slotFee,
          type: 'SLOT_FEE',
          description: `Aktivasi Slot Properti ke-${existingCount + 1} — ${dto.name}`,
          manager,
        });
      }

      const { resolved: resolvedImages, uploadedPaths } =
        await this.resolveImages(dto.images);

      try {
        const kost = kostRepo.create({
          ...dto,
          images: resolvedImages,
          propertyCategory: category,
          pricePerMonth:
            category === 'HUNIAN_HARIAN' || category === 'KONTRAKAN'
              ? 0
              : (dto.pricePerMonth ?? 0),
          city: toTitleCaseRegion(dto.city),
          district: toTitleCaseRegion(dto.district),
          ownerId,
          ownerName: creator?.name?.trim() || dto.ownerName || 'Pengelola Kost',
          ownerPhone:
            dto.ownerPhone?.trim() || creator?.phone?.trim() || '6281234567890',
          slug,
          approvalStatus: isAutoApproved ? 'APPROVED' : 'PENDING',
          isVerified: isAutoApproved,
          allowDirectBooking: isAutoApproved
            ? Boolean(dto.allowDirectBooking)
            : false,
          rejectionReason: '',
        });
        const saved = await kostRepo.save(kost);
        this._filtersCache.clear();
        return saved;
      } catch (err) {
        if (uploadedPaths.length > 0) {
          void Promise.allSettled(
            uploadedPaths.map((p) => this.storageService.deleteByUrl(p)),
          );
        }
        throw err;
      }
    });
  }

  async transferOwner(id: number, targetOwnerId: number): Promise<Kost> {
    if (!targetOwnerId || targetOwnerId <= 0) {
      throw new BadRequestException('ID pemilik tujuan tidak valid.');
    }

    const { saved, prevOwnerId, targetOwner } =
      await this.dataSource.transaction(async (manager) => {
        const kostRepo = manager.getRepository(Kost);
        const userRepo = manager.getRepository(User);
        const bookingRepo = manager.getRepository(Booking);

        const kost = await kostRepo.findOne({ where: { id } });
        if (!kost) {
          throw new NotFoundException(`Properti ID ${id} tidak ditemukan.`);
        }
        if (kost.ownerId === targetOwnerId) {
          throw new BadRequestException(
            'Properti ini sudah dimiliki oleh pengguna tersebut.',
          );
        }

        const targetUser = await userRepo.findOne({
          where: { id: targetOwnerId },
        });
        if (!targetUser) {
          throw new NotFoundException(
            `Pengguna ID ${targetOwnerId} tidak ditemukan.`,
          );
        }

        const targetActiveRole = (targetUser.role || '').toUpperCase();
        const targetRoles = Array.isArray(targetUser.roles)
          ? targetUser.roles.map((r) => String(r || '').trim().toUpperCase())
          : [];
        const isOwnerAccount =
          targetActiveRole === 'PEMILIK_KOST' ||
          targetRoles.includes('PEMILIK_KOST');
        if (!isOwnerAccount) {
          throw new BadRequestException(
            'Kepemilikan properti hanya dapat dipindahkan ke akun Pemilik Properti.',
          );
        }

        const activeEscrowCount = await bookingRepo.count({
          where: {
            kostId: id,
            escrowStatus: In(['HELD', 'DISPUTED']),
          },
        });
        if (activeEscrowCount > 0) {
          throw new BadRequestException(
            'Properti masih memiliki transaksi Escrow yang sedang berjalan atau bersengketa. Selesaikan terlebih dahulu sebelum memindahkan kepemilikan.',
          );
        }

        const oldOwnerId = kost.ownerId;

        // Pertahankan riwayat booking & survei lama agar tetap tercatat di pemilik sebelumnya
        await bookingRepo.update(
          { kostId: id, ownerId: IsNull() },
          { ownerId: oldOwnerId },
        );

        kost.ownerId = targetUser.id;
        kost.ownerName = targetUser.name.trim() || kost.ownerName;
        if (targetUser.phone && targetUser.phone.trim()) {
          kost.ownerPhone = targetUser.phone.trim();
        }
        const updatedKost = await kostRepo.save(kost);
        return {
          saved: updatedKost,
          prevOwnerId: oldOwnerId,
          targetOwner: targetUser,
        };
      });

    this._filtersCache.clear();
    await this.syncOwnerNames([saved]);

    await this.notificationsService
      ?.create({
        userId: targetOwner.id,
        type: 'PROPERTY',
        title: 'Kepemilikan Properti Diterima',
        body: `Anda kini menjadi pemilik properti "${saved.name}". Kelola properti Anda melalui Dashboard.`,
        targetUrl: '/dashboard',
      })
      .catch(() => undefined);

    if (prevOwnerId && prevOwnerId !== targetOwner.id) {
      await this.notificationsService
        ?.create({
          userId: prevOwnerId,
          type: 'PROPERTY',
          title: 'Kepemilikan Properti Dipindahkan',
          body: `Kepemilikan properti "${saved.name}" telah dipindahkan ke ${targetOwner.name}.`,
          targetUrl: '/dashboard',
        })
        .catch(() => undefined);
    }

    return saved;
  }

  async updateApproval(
    id: number,
    status: string,
    rejectionReason?: string,
    reviewerId?: number,
  ): Promise<Kost> {
    const normalized = (status || '').trim().toUpperCase();
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(normalized)) {
      throw new BadRequestException(
        'Status persetujuan harus APPROVED, REJECTED, atau PENDING',
      );
    }
    if (reviewerId !== undefined && reviewerId !== null) {
      const reviewer = await this.userRepository.findOne({
        where: { id: reviewerId },
      });
      const role = (reviewer?.role || '').toUpperCase();
      if (!reviewer || (role !== 'ADMINISTRATOR' && role !== 'STAFF')) {
        throw new ForbiddenException(
          'Hanya Administrator atau Staff yang dapat menyetujui properti',
        );
      }
    }
    const kost = await this.findOne(id);
    kost.approvalStatus = normalized;
    kost.rejectionReason =
      normalized === 'REJECTED' ? rejectionReason?.trim() || '' : '';
    const saved = await this.kostRepository.save(kost);

    if (
      (normalized === 'APPROVED' || normalized === 'REJECTED') &&
      kost.ownerId
    ) {
      try {
        const owner = await this.userRepository.findOne({
          where: { id: kost.ownerId },
        });
        const ownerTokens = Array.from(
          new Set(
            [
              ...(Array.isArray(owner?.fcmTokens) ? owner.fcmTokens : []),
              owner?.fcmToken || '',
            ]
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        );
        const title =
          normalized === 'APPROVED'
            ? 'Properti Disetujui'
            : 'Properti Ditolak';
        const body =
          normalized === 'APPROVED'
            ? `${kost.name} telah disetujui dan kini tampil di pencarian Keyloka.`
            : `${kost.name} perlu diperbaiki${kost.rejectionReason ? `: ${kost.rejectionReason}` : '.'}`;
        await this.firebaseNotificationService.sendGeneralNotification({
          tokens: ownerTokens,
          title,
          body,
          userId: kost.ownerId,
          notifType: 'PROPERTY',
          targetUrl: normalized === 'APPROVED' ? `/kost/${kost.id}` : '/dashboard',
          data: {
            type: 'property_approval',
            kostId: String(kost.id),
            receiverId: String(kost.ownerId),
          },
        });
        if (owner?.email) {
          void this.mailService?.sendEmail(owner.email, {
            subject:
              normalized === 'APPROVED'
                ? `[Keyloka] Properti "${kost.name}" Disetujui`
                : `[Keyloka] Properti "${kost.name}" Memerlukan Perbaikan`,
            badgeText:
              normalized === 'APPROVED'
                ? 'Properti Disetujui'
                : 'Perlu Perbaikan',
            badgeTone: normalized === 'APPROVED' ? 'emerald' : 'amber',
            title,
            greetingName: owner.name,
            intro: body,
            details: [
              { label: 'Nama Properti', value: kost.name },
              { label: 'Lokasi', value: `${kost.district}, ${kost.city}` },
              ...(kost.rejectionReason
                ? [{ label: 'Catatan Staff', value: kost.rejectionReason }]
                : []),
            ],
            ctaLabel:
              normalized === 'APPROVED'
                ? 'Lihat Halaman Properti'
                : 'Perbaiki di Dashboard',
            ctaUrl:
              normalized === 'APPROVED' ? `/kost/${kost.id}` : '/dashboard',
          });
        }
      } catch {
        // Abaikan jika push gagal
      }
    }

    this._filtersCache.clear();
    return saved;
  }

  async update(id: number, dto: UpdateKostDto): Promise<Kost> {
    const kost = await this.findOne(id);
    if (dto.allowDirectBooking === true && kost.ownerId) {
      const owner = await this.userRepository.findOne({
        where: { id: kost.ownerId },
      });
      const ownerRole = (owner?.role || '').toUpperCase();
      const isOwnerVerified =
        Boolean(owner?.isVerified) ||
        ownerRole === 'STAFF' ||
        ownerRole === 'ADMINISTRATOR';
      if (!isOwnerVerified) {
        throw new BadRequestException(
          'Pemilik properti harus terverifikasi terlebih dahulu sebelum mengaktifkan Booking Langsung (Escrow).',
        );
      }
    }
    const previousImages = Array.isArray(kost.images) ? [...kost.images] : [];
    const wasRejected = (kost.approvalStatus || '').toUpperCase() === 'REJECTED';
    Object.assign(kost, {
      ...dto,
      ...(dto.city !== undefined ? { city: toTitleCaseRegion(dto.city) } : {}),
      ...(dto.district !== undefined
        ? { district: toTitleCaseRegion(dto.district) }
        : {}),
    });
    const nextCat = (kost.propertyCategory || 'KOST').trim().toUpperCase();
    if (
      dto.propertyCategory !== undefined ||
      dto.pricePerMonth !== undefined ||
      dto.pricePerDay !== undefined ||
      dto.pricePerYear !== undefined
    ) {
      if (nextCat === 'KONTRAKAN') {
        kost.pricePerMonth = 0;
      } else if (nextCat === 'HUNIAN_HARIAN') {
        kost.pricePerMonth = 0;
      }
      this.validateCategoryPricing({
        category: nextCat,
        pricePerMonth: kost.pricePerMonth,
        pricePerDay: kost.pricePerDay,
        pricePerYear: kost.pricePerYear,
      });
    }
    if (wasRejected) {
      const owner = await this.userRepository.findOne({
        where: { id: kost.ownerId },
      });
      const ownerRole = (owner?.role || '').toUpperCase();
      if (ownerRole !== 'ADMINISTRATOR' && ownerRole !== 'STAFF') {
        kost.approvalStatus = 'PENDING';
        kost.rejectionReason = '';
      }
    }
    let newlyUploadedPaths: string[] = [];
    if (dto.images !== undefined) {
      const { resolved, uploadedPaths } = await this.resolveImages(dto.images);
      kost.images = resolved;
      newlyUploadedPaths = uploadedPaths;
    }
    let saved: Kost;
    try {
      saved = await this.kostRepository.save(kost);
    } catch (err) {
      if (newlyUploadedPaths.length > 0) {
        void Promise.allSettled(
          newlyUploadedPaths.map((p) => this.storageService.deleteByUrl(p)),
        );
      }
      throw err;
    }
    this._filtersCache.clear();
    if (dto.images !== undefined) {
      const nextSet = new Set(Array.isArray(saved.images) ? saved.images : []);
      const removed = previousImages.filter((url) => !nextSet.has(url));
      if (removed.length > 0) {
        void Promise.allSettled(
          removed.map((url) => this.storageService.deleteByUrl(url)),
        );
      }
    }
    this.normalizeKostImages([saved]);
    return saved;
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    const kost = await this.findOne(id);
    const imagesToDelete = Array.isArray(kost.images) ? [...kost.images] : [];
    await this.kostRepository.remove(kost);
    this._filtersCache.clear();
    if (imagesToDelete.length > 0) {
      void Promise.allSettled(
        imagesToDelete.map((url) => this.storageService.deleteByUrl(url)),
      );
    }
    return { deleted: true, id };
  }

  async updateRating(
    id: number,
    rating: number,
    reviewCount: number,
  ): Promise<void> {
    await this.kostRepository.update(id, { rating, reviewCount });
  }

  /**
   * Validates a base64 image payload, converts it to WebP via sharp (with original fallback),
   * and uploads it to R2 storage.
   */
  async uploadBase64Image(rawBase64: string): Promise<{
    url: string;
    path: string;
    sizeBytes: number;
  }> {
    const trimmed = rawBase64?.trim();
    if (!trimmed) {
      throw new BadRequestException('Data gambar base64 wajib diisi');
    }

    const base64Data = trimmed.includes(',')
      ? trimmed.split(',').pop() || ''
      : trimmed;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException('Format gambar tidak valid');
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Ukuran gambar mentah maksimal 8 MB');
    }

    const isJpeg =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const isPng =
      buffer.length >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const isWebp =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      throw new BadRequestException(
        'File bukan gambar JPEG, PNG, atau WebP yang valid',
      );
    }

    const fallbackExt = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
    let outputBuffer: Buffer = buffer;
    let outputExt = fallbackExt;
    try {
      outputBuffer = await sharp(buffer, { limitInputPixels: 100_000_000 })
        .rotate()
        .resize({
          width: 1440,
          height: 1440,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      outputExt = 'webp';
    } catch (err) {
      this.logger.warn(
        `[upload-image] sharp gagal memproses gambar, fallback ke file asli (${fallbackExt}): ${err instanceof Error ? err.message : err}`,
      );
      outputBuffer = buffer;
      outputExt = fallbackExt;
    }

    const contentType =
      outputExt === 'webp'
        ? 'image/webp'
        : outputExt === 'png'
          ? 'image/png'
          : 'image/jpeg';
    const key = this.storageService.buildKostImageKey(outputExt);
    const uploaded = await this.storageService.uploadBuffer(
      outputBuffer,
      key,
      contentType,
    );

    return {
      url: uploaded.url,
      path: `/${uploaded.key}`,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  /**
   * Resolves an images array during property create/update: uploads any inline
   * `data:image/...` payloads to R2 and preserves existing URLs/paths.
   */
  private async resolveImages(
    images?: string[],
  ): Promise<{ resolved: string[]; uploadedPaths: string[] }> {
    if (!Array.isArray(images) || images.length === 0) {
      return { resolved: [], uploadedPaths: [] };
    }
    const resolved: string[] = [];
    const uploadedPaths: string[] = [];
    try {
      for (const item of images) {
        const value = typeof item === 'string' ? item.trim() : '';
        if (!value) continue;
        if (/^data:image\//i.test(value)) {
          const uploaded = await this.uploadBase64Image(value);
          resolved.push(uploaded.url);
          uploadedPaths.push(uploaded.url);
        } else {
          resolved.push(this.storageService.resolvePublicUrl(value));
        }
      }
      return { resolved, uploadedPaths };
    } catch (err) {
      if (uploadedPaths.length > 0) {
        void Promise.allSettled(
          uploadedPaths.map((p) => this.storageService.deleteByUrl(p)),
        );
      }
      throw err;
    }
  }

  /**
   * Saves a property report from a logged-in user or anonymous visitor,
   * verifying Google reCAPTCHA when `RECAPTCHA_SECRET_KEY` is configured.
   */
  async reportKost(
    kostId: number,
    payload: {
      reason?: string;
      details?: string;
      recaptchaToken?: string;
      reporterId?: number | null;
    },
  ) {
    const kost = await this.kostRepository.findOne({ where: { id: kostId } });
    if (!kost) throw new NotFoundException('Properti tidak ditemukan');

    const reason = (payload.reason || '').trim().slice(0, 120);
    if (!reason) {
      throw new BadRequestException('Alasan laporan wajib diisi.');
    }

    const secret = (process.env.RECAPTCHA_SECRET_KEY || '').trim();
    if (secret) {
      const token = (payload.recaptchaToken || '').trim();
      if (!token) {
        throw new BadRequestException('Harap selesaikan verifikasi reCAPTCHA.');
      }
      const verifyRes = await fetch(
        'https://www.google.com/recaptcha/api/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret, response: token }).toString(),
        },
      );
      const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
        success?: boolean;
        score?: number;
      };
      if (
        !verifyJson.success ||
        (typeof verifyJson.score === 'number' && verifyJson.score < 0.3)
      ) {
        throw new BadRequestException(
          'Verifikasi reCAPTCHA gagal. Silakan coba lagi.',
        );
      }
    }

    let reporterId: number | null = null;
    let reporterName: string | null = null;
    let reporterEmail: string | null = null;

    if (payload.reporterId) {
      const user = await this.userRepository.findOne({
        where: { id: payload.reporterId },
      });
      if (user) {
        reporterId = user.id;
        reporterName = user.name || null;
        reporterEmail = user.email || null;

        const existing = await this.kostReportRepository.findOne({
          where: { kostId, reporterId: user.id, status: 'OPEN' },
        });
        if (existing) {
          throw new BadRequestException(
            'Anda sudah melaporkan properti ini sebelumnya.',
          );
        }
      }
    }

    const report = this.kostReportRepository.create({
      kostId,
      reporterId,
      reporterName,
      reporterEmail,
      reason,
      details: payload.details?.trim() || null,
      status: 'OPEN',
    });
    const saved = await this.kostReportRepository.save(report);
    return { success: true, id: saved.id };
  }

  /**
   * Lists open property reports for Staff/Admin moderation.
   */
  async findOpenReports() {
    const reports = await this.kostReportRepository.find({
      where: { status: 'OPEN' },
      order: { createdAt: 'DESC' },
    });
    if (reports.length === 0) return [];

    const kostIds = Array.from(new Set(reports.map((r) => r.kostId)));
    const kosts = await this.kostRepository.find({
      where: { id: In(kostIds) },
    });
    const kostMap = new Map(kosts.map((k) => [k.id, k]));

    return reports.map((report) => {
      const kost = kostMap.get(report.kostId);
      return {
        id: report.id,
        kostId: report.kostId,
        kostName: kost?.name || `Properti #${report.kostId}`,
        kostCity: kost?.city || '',
        kostDistrict: kost?.district || '',
        kostOwnerName: kost?.ownerName || '',
        reporterId: report.reporterId,
        reporterName: report.reporterName || null,
        reporterEmail: report.reporterEmail || null,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
      };
    });
  }

  async dismissReport(reportId: number) {
    const report = await this.kostReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Laporan tidak ditemukan');
    report.status = 'DISMISSED';
    await this.kostReportRepository.save(report);
    return { success: true };
  }

  private _todayWibDateString(): string {
    const wibMs = Date.now() + 7 * 60 * 60 * 1000;
    return new Date(wibMs).toISOString().slice(0, 10);
  }

  async recordEngagement(
    kostId: number,
    type: 'VIEW' | 'WA_CLICK',
    viewerIp: string,
    viewerUserId?: number | null,
  ): Promise<{ counted: boolean }> {
    const kost = await this.kostRepository.findOne({
      where: { id: kostId },
      select: ['id', 'ownerId', 'approvalStatus'],
    });
    if (!kost || (kost.approvalStatus || 'APPROVED').toUpperCase() !== 'APPROVED') {
      return { counted: false };
    }
    if (viewerUserId && kost.ownerId === viewerUserId) {
      return { counted: false };
    }

    const now = Date.now();
    const ttlMs = type === 'VIEW' ? 10 * 60_000 : 2 * 60_000;
    const dedupeKey = `${type}:${kostId}:${viewerUserId || viewerIp || 'anon'}`;
    const exp = this._engagementDedupe.get(dedupeKey);
    if (exp && now < exp) {
      return { counted: false };
    }
    this._engagementDedupe.set(dedupeKey, now + ttlMs);
    if (this._engagementDedupe.size > 10_000) {
      for (const [k, v] of this._engagementDedupe) {
        if (now >= v) this._engagementDedupe.delete(k);
      }
    }

    const date = this._todayWibDateString();
    const bucketKey = `${kostId}:${date}`;
    const existing = this._pendingMetrics.get(bucketKey) || {
      kostId,
      date,
      views: 0,
      waClicks: 0,
    };
    if (type === 'VIEW') {
      existing.views += 1;
    } else {
      existing.waClicks += 1;
    }
    this._pendingMetrics.set(bucketKey, existing);
    return { counted: true };
  }

  private async _flushPendingMetrics(): Promise<void> {
    if (this._pendingMetrics.size === 0) return;
    const batch = Array.from(this._pendingMetrics.values());
    this._pendingMetrics.clear();

    const kostTotals = new Map<number, { views: number; waClicks: number }>();
    for (const item of batch) {
      await this.dataSource.query(
        `
          INSERT INTO kost_daily_stats ("kostId", date, views, "waClicks")
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ("kostId", date)
          DO UPDATE SET
            views = kost_daily_stats.views + EXCLUDED.views,
            "waClicks" = kost_daily_stats."waClicks" + EXCLUDED."waClicks"
        `,
        [item.kostId, item.date, item.views, item.waClicks],
      );
      const prev = kostTotals.get(item.kostId) || { views: 0, waClicks: 0 };
      prev.views += item.views;
      prev.waClicks += item.waClicks;
      kostTotals.set(item.kostId, prev);
    }

    for (const [kostId, delta] of kostTotals) {
      await this.dataSource.query(
        `
          UPDATE kosts
          SET "viewCount" = COALESCE("viewCount", 0) + $2,
              "waClickCount" = COALESCE("waClickCount", 0) + $3
          WHERE id = $1
        `,
        [kostId, delta.views, delta.waClicks],
      );
    }
  }

  async getOwnerStatistics(
    ownerId: number,
    opts?: { period?: string; kostId?: number },
  ) {
    await this._flushPendingMetrics().catch(() => undefined);

    const period = (opts?.period || '6M').toUpperCase();
    const filterKostId =
      opts?.kostId && Number.isFinite(opts.kostId) && opts.kostId > 0
        ? Number(opts.kostId)
        : null;

    const ownerKosts = await this.kostRepository.find({
      where: filterKostId ? { id: filterKostId, ownerId } : { ownerId },
      order: { createdAt: 'DESC' },
    });

    const kostIds = ownerKosts.map((k) => k.id);
    const totalRoomsAvailable = ownerKosts.reduce(
      (sum, k) => sum + Number(k.availableRooms ?? 0),
      0,
    );
    const totalViews = ownerKosts.reduce(
      (sum, k) => sum + Number(k.viewCount ?? 0),
      0,
    );
    const totalWaClicks = ownerKosts.reduce(
      (sum, k) => sum + Number(k.waClickCount ?? 0),
      0,
    );

    const now = new Date();
    const dailyDays = 30;
    const dailyStart = new Date(now);
    dailyStart.setDate(dailyStart.getDate() - (dailyDays - 1));
    const dailyStartStr = new Date(dailyStart.getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const monthsCount = period === '12M' ? 12 : 6;
    let bookingCutoff: Date | null = null;
    if (period === '30D') {
      bookingCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === '6M' || period === '12M') {
      bookingCutoff = new Date(
        now.getFullYear(),
        now.getMonth() - (monthsCount - 1),
        1,
      );
    }

    if (kostIds.length === 0) {
      return {
        period,
        kostId: filterKostId,
        summary: {
          totalProperties: 0,
          totalRoomsAvailable: 0,
          totalViews: 0,
          totalWaClicks: 0,
          totalFavorites: 0,
          totalChats: 0,
          totalSurveys: 0,
          totalDirectBookings: 0,
          paidBookingsCount: 0,
          totalGrossRevenue: 0,
          totalNetRevenue: 0,
          avgRating: 0,
          totalReviews: 0,
          surveyApprovalRate: 0,
        },
        dailyEngagement: [],
        monthlyTrend: [],
        statusBreakdown: {
          activeOrDone: 0,
          paidHeld: 0,
          pending: 0,
          cancelledOrRejected: 0,
          fullScheme: 0,
          dpScheme: 0,
        },
        reviewBreakdown: {
          count: 0,
          avgOverall: 0,
          avgCleanliness: 0,
          avgSecurity: 0,
          avgAccuracy: 0,
        },
        propertyPerformance: [],
      };
    }

    const [
      dailyRows,
      favoriteRows,
      chatCountRow,
      bookingSummaryRows,
      monthlyRows,
      reviewRow,
      propertyBookingRows,
    ] = await Promise.all([
      this.dataSource.query(
        `
          SELECT date, SUM(views)::int AS views, SUM("waClicks")::int AS "waClicks"
          FROM kost_daily_stats
          WHERE "kostId" = ANY($1) AND date >= $2
          GROUP BY date
          ORDER BY date ASC
        `,
        [kostIds, dailyStartStr],
      ) as Promise<Array<{ date: string; views: number; waClicks: number }>>,
      this.dataSource.query(
        `
          SELECT "kostId", COUNT(*)::int AS cnt
          FROM user_favorites
          WHERE "kostId" = ANY($1)
          GROUP BY "kostId"
        `,
        [kostIds],
      ) as Promise<Array<{ kostId: number; cnt: number }>>,
      this.dataSource.query(
        `
          SELECT COUNT(DISTINCT ("senderId", "kostId"))::int AS cnt
          FROM chat_messages
          WHERE "kostId" = ANY($1) AND "receiverId" = $2 AND "senderId" <> $2
        `,
        [kostIds, ownerId],
      ) as Promise<Array<{ cnt: number }>>,
      this.dataSource.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", 'SURVEI')) = 'SURVEI')::int AS surveys,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", 'SURVEI')) = 'SURVEI' AND UPPER(status) IN ('DISETUJUI', 'APPROVED', 'SELESAI'))::int AS surveys_approved,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA')::int AS direct_bookings,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED')::int AS paid_bookings,
            COALESCE(SUM(CASE WHEN UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED' THEN COALESCE(NULLIF("paidAmount", 0), "totalAmount", 0) ELSE 0 END), 0)::bigint AS gross_revenue,
            COALESCE(SUM(CASE WHEN UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED' THEN COALESCE("ownerNetAmount", 0) ELSE 0 END), 0)::bigint AS net_revenue,
            COUNT(*) FILTER (WHERE UPPER(status) IN ('AKTIF', 'SELESAI'))::int AS active_or_done,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("escrowStatus", '')) = 'HELD' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID')::int AS paid_held,
            COUNT(*) FILTER (WHERE UPPER(status) IN ('TERKIRIM', 'MENUNGGU KONFIRMASI', 'MENUNGGU_PEMBAYARAN', 'DISETUJUI'))::int AS pending_cnt,
            COUNT(*) FILTER (WHERE UPPER(status) IN ('DIBATALKAN', 'DITOLAK'))::int AS cancelled_cnt,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentScheme", 'FULL')) = 'FULL')::int AS full_scheme,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentScheme", '')) = 'DP')::int AS dp_scheme
          FROM bookings
          WHERE "kostId" = ANY($1)
            AND ($2::timestamp IS NULL OR "createdAt" >= $2)
        `,
        [kostIds, bookingCutoff],
      ) as Promise<Array<Record<string, string | number>>>,
      this.dataSource.query(
        `
          SELECT
            TO_CHAR("createdAt" AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month_key,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", 'SURVEI')) = 'SURVEI')::int AS surveys,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED')::int AS direct_bookings,
            COALESCE(SUM(CASE WHEN UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED' THEN COALESCE(NULLIF("paidAmount", 0), "totalAmount", 0) ELSE 0 END), 0)::bigint AS gross_revenue,
            COALESCE(SUM(CASE WHEN UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED' THEN COALESCE("ownerNetAmount", 0) ELSE 0 END), 0)::bigint AS net_revenue
          FROM bookings
          WHERE "kostId" = ANY($1)
            AND ($2::timestamp IS NULL OR "createdAt" >= $2)
          GROUP BY month_key
          ORDER BY month_key ASC
        `,
        [kostIds, bookingCutoff],
      ) as Promise<
        Array<{
          month_key: string;
          surveys: number;
          direct_bookings: number;
          gross_revenue: string;
          net_revenue: string;
        }>
      >,
      this.dataSource.query(
        `
          SELECT
            COUNT(*)::int AS cnt,
            COALESCE(ROUND(AVG("overallRating")::numeric, 2), 0)::float AS avg_overall,
            COALESCE(ROUND(AVG("ratingCleanliness")::numeric, 2), 0)::float AS avg_cleanliness,
            COALESCE(ROUND(AVG("ratingSecurity")::numeric, 2), 0)::float AS avg_security,
            COALESCE(ROUND(AVG("ratingAccuracy")::numeric, 2), 0)::float AS avg_accuracy
          FROM reviews
          WHERE "kostId" = ANY($1)
        `,
        [kostIds],
      ) as Promise<
        Array<{
          cnt: number;
          avg_overall: number;
          avg_cleanliness: number;
          avg_security: number;
          avg_accuracy: number;
        }>
      >,
      this.dataSource.query(
        `
          SELECT
            "kostId",
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", 'SURVEI')) = 'SURVEI')::int AS surveys,
            COUNT(*) FILTER (WHERE UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED')::int AS bookings,
            COALESCE(SUM(CASE WHEN UPPER(COALESCE("bookingType", '')) = 'SEWA' AND UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE("escrowStatus", '')) <> 'REFUNDED' THEN COALESCE("ownerNetAmount", 0) ELSE 0 END), 0)::bigint AS net_revenue
          FROM bookings
          WHERE "kostId" = ANY($1)
            AND ($2::timestamp IS NULL OR "createdAt" >= $2)
          GROUP BY "kostId"
        `,
        [kostIds, bookingCutoff],
      ) as Promise<
        Array<{
          kostId: number;
          surveys: number;
          bookings: number;
          net_revenue: string;
        }>
      >,
    ]);

    const dailyMap = new Map(dailyRows.map((r) => [r.date, r]));
    const dailyEngagement: Array<{
      date: string;
      label: string;
      views: number;
      waClicks: number;
    }> = [];
    for (let i = dailyDays - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = new Date(d.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const found = dailyMap.get(iso);
      dailyEngagement.push({
        date: iso,
        label: d.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
        }),
        views: Number(found?.views ?? 0),
        waClicks: Number(found?.waClicks ?? 0),
      });
    }

    const monthlyMap = new Map(monthlyRows.map((r) => [r.month_key, r]));
    const monthlyTrend: Array<{
      key: string;
      label: string;
      surveys: number;
      directBookings: number;
      grossRevenue: number;
      netRevenue: number;
    }> = [];
    const trendMonths = period === 'ALL' ? Math.max(6, monthlyRows.length) : monthsCount;
    for (let i = trendMonths - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const found = monthlyMap.get(key);
      monthlyTrend.push({
        key,
        label: d.toLocaleDateString('id-ID', {
          month: 'short',
          year: '2-digit',
        }),
        surveys: Number(found?.surveys ?? 0),
        directBookings: Number(found?.direct_bookings ?? 0),
        grossRevenue: Number(found?.gross_revenue ?? 0),
        netRevenue: Number(found?.net_revenue ?? 0),
      });
    }

    const favMap = new Map(favoriteRows.map((r) => [Number(r.kostId), Number(r.cnt)]));
    const totalFavorites = Array.from(favMap.values()).reduce((a, b) => a + b, 0);
    const propBookingMap = new Map(
      propertyBookingRows.map((r) => [Number(r.kostId), r]),
    );
    const bs = bookingSummaryRows[0] || {};
    const rev = reviewRow[0] || {
      cnt: 0,
      avg_overall: 0,
      avg_cleanliness: 0,
      avg_security: 0,
      avg_accuracy: 0,
    };

    const totalSurveys = Number(bs.surveys ?? 0);
    const surveysApproved = Number(bs.surveys_approved ?? 0);
    const surveyApprovalRate =
      totalSurveys > 0 ? Math.round((surveysApproved / totalSurveys) * 100) : 0;

    const propertyPerformance = ownerKosts
      .map((k) => {
        const pb = propBookingMap.get(k.id);
        return {
          kostId: k.id,
          name: k.name,
          city: k.city,
          propertyCategory: k.propertyCategory,
          availableRooms: Number(k.availableRooms ?? 0),
          rating: Number(k.rating ?? 0),
          reviewCount: Number(k.reviewCount ?? 0),
          views: Number(k.viewCount ?? 0),
          waClicks: Number(k.waClickCount ?? 0),
          favorites: favMap.get(k.id) ?? 0,
          surveys: Number(pb?.surveys ?? 0),
          bookings: Number(pb?.bookings ?? 0),
          netRevenue: Number(pb?.net_revenue ?? 0),
          isBoosted:
            Boolean(k.boostedUntil) &&
            new Date(k.boostedUntil!).getTime() > Date.now(),
        };
      })
      .sort(
        (a, b) =>
          b.netRevenue - a.netRevenue ||
          b.bookings - a.bookings ||
          b.views - a.views,
      );

    return {
      period,
      kostId: filterKostId,
      summary: {
        totalProperties: ownerKosts.length,
        totalRoomsAvailable,
        totalViews,
        totalWaClicks,
        totalFavorites,
        totalChats: Number(chatCountRow[0]?.cnt ?? 0),
        totalSurveys,
        totalDirectBookings: Number(bs.direct_bookings ?? 0),
        paidBookingsCount: Number(bs.paid_bookings ?? 0),
        totalGrossRevenue: Number(bs.gross_revenue ?? 0),
        totalNetRevenue: Number(bs.net_revenue ?? 0),
        avgRating: Number(rev.avg_overall ?? 0),
        totalReviews: Number(rev.cnt ?? 0),
        surveyApprovalRate,
      },
      dailyEngagement,
      monthlyTrend,
      statusBreakdown: {
        activeOrDone: Number(bs.active_or_done ?? 0),
        paidHeld: Number(bs.paid_held ?? 0),
        pending: Number(bs.pending_cnt ?? 0),
        cancelledOrRejected: Number(bs.cancelled_cnt ?? 0),
        fullScheme: Number(bs.full_scheme ?? 0),
        dpScheme: Number(bs.dp_scheme ?? 0),
      },
      reviewBreakdown: {
        count: Number(rev.cnt ?? 0),
        avgOverall: Number(rev.avg_overall ?? 0),
        avgCleanliness: Number(rev.avg_cleanliness ?? 0),
        avgSecurity: Number(rev.avg_security ?? 0),
        avgAccuracy: Number(rev.avg_accuracy ?? 0),
      },
      propertyPerformance,
    };
  }
}
