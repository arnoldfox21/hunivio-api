import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kost } from './entities/kost.entity';
import { CreateKostDto } from './dto/create-kost.dto';

@Injectable()
export class KostsService implements OnModuleInit {
  constructor(
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
  ) {}

  async onModuleInit() {
    await this.cleanBrandNamesInDb();
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
    type?: string;
    city?: string;
    facility?: string;
    minPrice?: string;
    maxPrice?: string;
    sortBy?: string;
  }): Promise<Kost[]> {
    const qb = this.kostRepository.createQueryBuilder('kost');

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

    return qb.getMany();
  }

  async getCities() {
    const raw = await this.kostRepository
      .createQueryBuilder('kost')
      .select('kost.city', 'city')
      .addSelect('COUNT(kost.id)', 'count')
      .groupBy('kost.city')
      .orderBy('COUNT(kost.id)', 'DESC')
      .getRawMany();
    return raw.map((r) => ({ city: r.city, count: Number(r.count) }));
  }

  async getFilters() {
    const allKosts = await this.kostRepository.find();
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

  async toggleFavorite(id: number): Promise<Kost> {
    const kost = await this.findOne(id);
    kost.isFavorite = !kost.isFavorite;
    return this.kostRepository.save(kost);
  }

  async decrementAvailableRoom(id: number): Promise<Kost> {
    const kost = await this.findOne(id);
    if (kost.availableRooms > 0) {
      kost.availableRooms -= 1;
      return this.kostRepository.save(kost);
    }
    return kost;
  }

  async findOne(id: number): Promise<Kost> {
    const kost = await this.kostRepository.findOne({ where: { id } });
    if (!kost) {
      throw new NotFoundException(`Kost dengan ID ${id} tidak ditemukan`);
    }
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
    const kost = this.kostRepository.create({
      ...dto,
      slug,
    });
    return this.kostRepository.save(kost);
  }
}
