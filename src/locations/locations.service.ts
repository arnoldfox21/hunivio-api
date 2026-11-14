import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Region } from './entities/region.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { INDONESIA_REGIONS_SEED } from './regions.seed';

@Injectable()
export class LocationsService implements OnModuleInit {
  constructor(
    @InjectRepository(Region)
    private readonly regionRepository: Repository<Region>,
    @InjectRepository(Kost)
    private readonly kostRepository: Repository<Kost>,
  ) {}

  async onModuleInit() {
    await this.seedRegionsIfNeeded();
  }

  async seedRegionsIfNeeded() {
    const existing = await this.regionRepository.find({
      select: ['id', 'name'],
    });
    const existingNames = new Set(
      existing.map((r) => r.name.trim().toLowerCase()),
    );

    const toInsert = INDONESIA_REGIONS_SEED.filter(
      (item) => !existingNames.has(item.name.trim().toLowerCase()),
    ).map((item) =>
      this.regionRepository.create({
        name: item.name,
        type: item.type,
        province: item.province,
        districts: item.districts,
      }),
    );

    if (toInsert.length > 0) {
      await this.regionRepository.save(toInsert);
      console.log(`Seeded ${toInsert.length} Indonesian regions & districts`);
    }
  }

  async searchCities(q?: string): Promise<string[]> {
    const queryText = (q || '').trim().toLowerCase();
    const regions = await this.regionRepository.find({
      order: { name: 'ASC' },
    });
    const kostCitiesRaw = await this.kostRepository
      .createQueryBuilder('kost')
      .select('DISTINCT kost.city', 'city')
      .where("kost.city IS NOT NULL AND TRIM(kost.city) != ''")
      .getRawMany<{ city: string }>();

    const seen = new Map<string, string>();
    for (const r of regions) {
      const key = r.name.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, r.name.trim());
    }
    for (const row of kostCitiesRaw) {
      const val = (row.city || '').trim();
      const key = val.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, val);
    }

    const all = Array.from(seen.values());
    if (!queryText) return all;

    return all
      .filter((c) => c.toLowerCase().includes(queryText))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(queryText) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(queryText) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      });
  }

  async searchDistricts(city?: string, q?: string): Promise<string[]> {
    const cityText = (city || '').trim().toLowerCase();
    const queryText = (q || '').trim().toLowerCase();

    const regions = await this.regionRepository.find({
      order: { name: 'ASC' },
    });

    const normalizedCity = cityText
      .replace(/^(kota|kabupaten|kab\.?)\s+/i, '')
      .trim();

    const matchedRegions = cityText
      ? regions.filter((r) => {
          const rLower = r.name.toLowerCase();
          const rClean = rLower
            .replace(/^(kota|kabupaten|kab\.?)\s+/i, '')
            .trim();
          return (
            rLower === cityText ||
            rClean === normalizedCity ||
            rLower.includes(cityText) ||
            cityText.includes(rClean)
          );
        })
      : regions;

    const seen = new Map<string, string>();
    for (const r of matchedRegions) {
      for (const d of r.districts || []) {
        const clean = d.trim();
        const key = clean.toLowerCase();
        if (key && !seen.has(key)) seen.set(key, clean);
      }
    }

    const qb = this.kostRepository
      .createQueryBuilder('kost')
      .select('DISTINCT kost.district', 'district')
      .where("kost.district IS NOT NULL AND TRIM(kost.district) != ''");
    if (cityText) {
      qb.andWhere('LOWER(kost.city) LIKE :city', {
        city: `%${normalizedCity || cityText}%`,
      });
    }
    const kostDistrictsRaw = await qb.getRawMany<{ district: string }>();
    for (const row of kostDistrictsRaw) {
      const val = (row.district || '').trim();
      const key = val.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, val);
    }

    const all = Array.from(seen.values());
    if (!queryText) return all;

    return all
      .filter((d) => d.toLowerCase().includes(queryText))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(queryText) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(queryText) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      });
  }
}
