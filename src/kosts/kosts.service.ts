import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Kost } from './entities/kost.entity';
import { Facility } from './entities/facility.entity';
import { UserFavorite } from './entities/user-favorite.entity';
import { User } from '../users/entities/user.entity';
import { CreateKostDto } from './dto/create-kost.dto';
import { UpdateKostDto } from './dto/update-kost.dto';
import { FirebaseNotificationService } from '../chats/firebase-notification.service';
import { toTitleCaseRegion } from '../common/region-format.util';
import { StorageService } from '../storage/storage.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import {
  EXTRA_PROPERTY_SLOT_FEE,
  FREE_PROPERTY_QUOTA,
  WalletService,
} from '../wallet/wallet.service';

@Injectable()
export class KostsService implements OnModuleInit {
  constructor(
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,
    @InjectRepository(UserFavorite)
    private readonly favoriteRepository: Repository<UserFavorite>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly firebaseNotificationService: FirebaseNotificationService,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  async onModuleInit() {
    await this.cleanBrandNamesInDb();
    if (process.env.ENABLE_AUTO_SEED === 'true') {
      await this.seedFacilitiesIfNeeded();
    }
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

  async syncOwnerNames(kosts: Kost[]): Promise<Kost[]> {
    if (kosts.length === 0) return kosts;
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
    const isAutoApproved =
      creatorRole === 'ADMINISTRATOR' || creatorRole === 'STAFF';

    return this.dataSource.transaction(async (manager) => {
      const kostRepo = manager.getRepository(Kost);
      const existingCount = await kostRepo.count({ where: { ownerId } });

      if (!isAutoApproved && existingCount >= FREE_PROPERTY_QUOTA) {
        await this.walletService.deductCredit({
          userId: ownerId,
          amount: EXTRA_PROPERTY_SLOT_FEE,
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
    const kost = await this.kostRepository.findOne({ where: { id } });
    if (!kost) {
      throw new NotFoundException(`Properti ID ${id} tidak ditemukan.`);
    }
    const targetOwner = await this.userRepository.findOne({
      where: { id: targetOwnerId },
    });
    if (!targetOwner) {
      throw new NotFoundException(
        `Pengguna ID ${targetOwnerId} tidak ditemukan.`,
      );
    }
    kost.ownerId = targetOwner.id;
    kost.ownerName = targetOwner.name.trim() || kost.ownerName;
    if (targetOwner.phone && targetOwner.phone.trim()) {
      kost.ownerPhone = targetOwner.phone.trim();
    }
    const saved = await this.kostRepository.save(kost);
    this._filtersCache.clear();
    await this.syncOwnerNames([saved]);
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
        const token = owner?.fcmToken?.trim();
        if (token) {
          const title =
            normalized === 'APPROVED'
              ? 'Properti Disetujui'
              : 'Properti Ditolak';
          const body =
            normalized === 'APPROVED'
              ? `${kost.name} telah disetujui dan kini tampil di pencarian Keyloka.`
              : `${kost.name} perlu diperbaiki${kost.rejectionReason ? `: ${kost.rejectionReason}` : '.'}`;
          await this.firebaseNotificationService.sendGeneralNotification({
            token,
            title,
            body,
            data: {
              type: 'property_approval',
              kostId: String(kost.id),
              receiverId: String(kost.ownerId),
            },
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
      console.warn(
        `[upload-image] sharp gagal memproses gambar, fallback ke file asli (${fallbackExt}):`,
        err instanceof Error ? err.message : err,
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
          resolved.push(uploaded.path);
          uploadedPaths.push(uploaded.path);
        } else {
          resolved.push(value);
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
}
