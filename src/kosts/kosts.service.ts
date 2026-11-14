import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Kost } from './entities/kost.entity';
import { Facility } from './entities/facility.entity';
import { UserFavorite } from './entities/user-favorite.entity';
import { User } from '../users/entities/user.entity';
import { CreateKostDto } from './dto/create-kost.dto';
import { UpdateKostDto } from './dto/update-kost.dto';
import { buildMalangDummyKosts, buildMalangApartmentsAndKontrakans } from './malang-kosts.seed';
import { FirebaseNotificationService } from '../chats/firebase-notification.service';

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
  ) {}

  async onModuleInit() {
    await this.cleanBrandNamesInDb();
    await this.seedMalangDummyKostsIfNeeded();
    await this.seedFacilitiesIfNeeded();
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

  async getMasterFacilities() {
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

  private async seedMalangDummyKostsIfNeeded() {
    const candidates = [
      ...buildMalangDummyKosts(100),
      ...buildMalangApartmentsAndKontrakans(),
    ];
    const existingSlugs = new Set(
      (
        await this.kostRepository
          .createQueryBuilder('kost')
          .select('kost.slug', 'slug')
          .getRawMany()
      ).map((r) => r.slug),
    );

    const toInsert = candidates.filter((c) => c.slug && !existingSlugs.has(c.slug));
    if (toInsert.length > 0) {
      await this.kostRepository.save(
        toInsert.map((item) => this.kostRepository.create(item)),
      );
    }
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
      if (updated) {
        await this.kostRepository.save(k);
      }
    }
  }

  async findAll(query: {
    search?: string;
    propertyCategory?: string;
    type?: string;
    city?: string;
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
      qb.andWhere('UPPER(kost.propertyCategory) = UPPER(:cat)', {
        cat: query.propertyCategory,
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

    if (query.minPrice) {
      const min = parseInt(query.minPrice, 10);
      if (!isNaN(min)) {
        qb.andWhere('kost.pricePerMonth >= :min', { min });
      }
    }

    if (query.maxPrice) {
      const max = parseInt(query.maxPrice, 10);
      if (!isNaN(max)) {
        qb.andWhere('kost.pricePerMonth <= :max', { max });
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
        qb.orderBy('kost.pricePerMonth', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('kost.pricePerMonth', 'DESC');
        break;
      case 'rating_desc':
        qb.orderBy('kost.rating', 'DESC');
        break;
      default:
        qb.orderBy('kost.isSinggahsini', 'DESC').addOrderBy(
          'kost.rating',
          'DESC',
        );
        break;
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

  private async syncOwnerNames(kosts: Kost[]): Promise<Kost[]> {
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
        if (owner.phone && owner.phone.trim()) {
          k.ownerPhone = owner.phone.trim();
        }
      }
      (k as Kost & { showOwnerWhatsapp?: boolean }).showOwnerWhatsapp = Boolean(
        owner?.showWhatsapp,
      );
    }
    return kosts;
  }

  async getMapPoints(query: {
    propertyCategory?: string;
    type?: string;
    city?: string;
  }) {
    const qb = this.kostRepository
      .createQueryBuilder('kost')
      .select([
        'kost.id',
        'kost.name',
        'kost.propertyCategory',
        'kost.type',
        'kost.city',
        'kost.district',
        'kost.pricePerMonth',
        'kost.rating',
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
      qb.andWhere('UPPER(kost.propertyCategory) = UPPER(:cat)', {
        cat: query.propertyCategory,
      });
    }
    if (query.type && query.type !== 'Semua') {
      qb.andWhere('LOWER(kost.type) = LOWER(:type)', { type: query.type });
    }
    if (query.city && query.city !== 'Semua Kota') {
      qb.andWhere('LOWER(kost.city) = LOWER(:city)', { city: query.city });
    }
    const list = await qb.getMany();
    return this.syncOwnerNames(list);
  }

  async getCities() {
    const raw = await this.kostRepository
      .createQueryBuilder('kost')
      .select('kost.city', 'city')
      .addSelect('COUNT(kost.id)', 'count')
      .where('kost.approvalStatus = :approvedStatus', {
        approvedStatus: 'APPROVED',
      })
      .groupBy('kost.city')
      .orderBy('COUNT(kost.id)', 'DESC')
      .getRawMany();
    return raw.map((r) => ({ city: r.city, count: Number(r.count) }));
  }

  async getFilters() {
    const allKosts = await this.kostRepository.find({
      where: { approvalStatus: 'APPROVED' },
    });
    const cityCounts = new Map<string, number>();
    const typesSet = new Set<string>();
    const facilitiesCount = new Map<string, number>();

    for (const k of allKosts) {
      if (k.city) {
        cityCounts.set(k.city, (cityCounts.get(k.city) || 0) + 1);
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

    const cities = Array.from(cityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([city]) => city);

    const types = Array.from(typesSet);

    const facilities = Array.from(facilitiesCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([fac]) => fac);

    return {
      cities,
      types,
      facilities,
    };
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

  async create(dto: CreateKostDto): Promise<Kost> {
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
    const kost = this.kostRepository.create({
      ...dto,
      ownerId,
      ownerName: creator?.name?.trim() || dto.ownerName || 'Pengelola Kost',
      ownerPhone: creator?.phone?.trim() || dto.ownerPhone || '6281234567890',
      slug,
      approvalStatus: isAutoApproved ? 'APPROVED' : 'PENDING',
      rejectionReason: '',
    });
    return this.kostRepository.save(kost);
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
              ? `${kost.name} telah disetujui dan kini tampil di pencarian HuniVio.`
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

    return saved;
  }

  async update(id: number, dto: UpdateKostDto): Promise<Kost> {
    const kost = await this.findOne(id);
    const wasRejected = (kost.approvalStatus || '').toUpperCase() === 'REJECTED';
    Object.assign(kost, dto);
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
    return this.kostRepository.save(kost);
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    const kost = await this.findOne(id);
    await this.kostRepository.remove(kost);
    return { deleted: true, id };
  }

  async updateRating(
    id: number,
    rating: number,
    reviewCount: number,
  ): Promise<void> {
    await this.kostRepository.update(id, { rating, reviewCount });
  }
}
