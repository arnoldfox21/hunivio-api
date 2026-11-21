import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource, LessThan, Repository } from 'typeorm';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PlatformEventLog } from './entities/platform-event-log.entity';
import { UpdatePlatformConfigDto } from './dto/update-platform-config.dto';

const CACHE_TTL_MS = 30_000;
const LOG_RETENTION_DAYS = 14;
const SENSITIVE_KEY_PATTERN =
  /(password|token|authorization|cookie|secret|signature|key)/i;

@Injectable()
export class PlatformService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformService.name);
  private _cache: { data: PlatformSetting; expiresAt: number } | null = null;
  private _inflight: Promise<PlatformSetting> | null = null;
  private _pruneTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
    @InjectRepository(PlatformEventLog)
    private readonly logRepo: Repository<PlatformEventLog>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id integer PRIMARY KEY DEFAULT 1,
        "freePropertyQuota" integer NOT NULL DEFAULT 2,
        "extraPropertySlotFee" integer NOT NULL DEFAULT 10000,
        "bookingPlatformFeePercent" integer NOT NULL DEFAULT 1,
        "minWithdrawAmount" integer NOT NULL DEFAULT 10000,
        "boost3dPrice" integer NOT NULL DEFAULT 5000,
        "boost7dPrice" integer NOT NULL DEFAULT 10000,
        "boost14dPrice" integer NOT NULL DEFAULT 18000,
        "allowOwnerRegistration" boolean NOT NULL DEFAULT true,
        "allowDirectBookingGlobal" boolean NOT NULL DEFAULT true,
        "maintenanceMode" boolean NOT NULL DEFAULT false,
        "maintenanceMessage" text NOT NULL DEFAULT '',
        "opsNotificationEmail" varchar(255) NOT NULL DEFAULT '',
        "updatedByUserId" integer NULL,
        "updatedAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await this.dataSource.query(`
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "allowWalletTopup" boolean NOT NULL DEFAULT true;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxPendingPropertiesPerOwner" integer NOT NULL DEFAULT 10;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "chatRateLimitPerMin" integer NOT NULL DEFAULT 12;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxActiveSurveysPerUser" integer NOT NULL DEFAULT 5;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxDailySurveysPerUser" integer NOT NULL DEFAULT 8;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxUnpaidBookingsPerUser" integer NOT NULL DEFAULT 2;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxHourlyDirectBookingsPerUser" integer NOT NULL DEFAULT 5;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "maxPendingTopupsPerOwner" integer NOT NULL DEFAULT 3;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "postRateLimitPerMin" integer NOT NULL DEFAULT 5;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS "commentRateLimitPerMin" integer NOT NULL DEFAULT 6;
    `);
    await this.dataSource.query(
      `INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`,
    );
    await this.getSettings().catch(() => null);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS platform_event_logs (
        id SERIAL PRIMARY KEY,
        level varchar(16) NOT NULL DEFAULT 'INFO',
        category varchar(32) NOT NULL DEFAULT 'SYSTEM',
        "actorUserId" integer NULL,
        message text NOT NULL,
        meta jsonb NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_platform_event_logs_createdAt" ON platform_event_logs ("createdAt");
      CREATE INDEX IF NOT EXISTS "IDX_platform_event_logs_level" ON platform_event_logs (level);
      CREATE INDEX IF NOT EXISTS "IDX_platform_event_logs_category" ON platform_event_logs (category);
    `);

    this._pruneTimer = setInterval(() => {
      this.pruneOldLogs().catch((err) => {
        this.logger.warn(
          `Gagal membersihkan platform_event_logs lama: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, 6 * 60 * 60 * 1000);
    this._pruneTimer.unref();
  }

  onModuleDestroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
  }

  private _sanitizeMeta(
    value: Record<string, unknown> | undefined | null,
  ): Record<string, unknown> | null {
    if (!value) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this._sanitizeMeta(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  async pruneOldLogs(): Promise<number> {
    const cutoff = new Date(
      Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const res = await this.logRepo.delete({ createdAt: LessThan(cutoff) });
    return res.affected || 0;
  }

  getCachedSettingsSync(): PlatformSetting | null {
    if (this._cache && Date.now() >= this._cache.expiresAt && !this._inflight) {
      void this.getSettings().catch(() => null);
    } else if (!this._cache && !this._inflight) {
      void this.getSettings().catch(() => null);
    }
    return this._cache?.data ?? null;
  }

  async getSettings(): Promise<PlatformSetting> {
    const now = Date.now();
    if (this._cache && now < this._cache.expiresAt) {
      return this._cache.data;
    }
    if (this._inflight) {
      return this._inflight;
    }

    this._inflight = (async () => {
      let row = await this.settingRepo.findOne({ where: { id: 1 } });
      if (!row) {
        row = this.settingRepo.create({ id: 1 });
        row = await this.settingRepo.save(row);
      }
      this._cache = {
        data: row,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return row;
    })().finally(() => {
      this._inflight = null;
    });

    return this._inflight;
  }

  async updateSettings(
    dto: UpdatePlatformConfigDto,
    actorUserId: number,
  ): Promise<PlatformSetting> {
    let row = await this.settingRepo.findOne({ where: { id: 1 } });
    if (!row) {
      row = this.settingRepo.create({ id: 1 });
    }

    const changedKeys: string[] = [];
    const applyField = <K extends keyof UpdatePlatformConfigDto>(
      key: K,
      val: UpdatePlatformConfigDto[K],
    ) => {
      if (val !== undefined && (row as unknown as Record<string, unknown>)[key] !== val) {
        (row as unknown as Record<string, unknown>)[key] = val;
        changedKeys.push(String(key));
      }
    };

    applyField('freePropertyQuota', dto.freePropertyQuota);
    applyField('extraPropertySlotFee', dto.extraPropertySlotFee);
    applyField('bookingPlatformFeePercent', dto.bookingPlatformFeePercent);
    applyField('minWithdrawAmount', dto.minWithdrawAmount);
    applyField('boost3dPrice', dto.boost3dPrice);
    applyField('boost7dPrice', dto.boost7dPrice);
    applyField('boost14dPrice', dto.boost14dPrice);
    applyField('allowOwnerRegistration', dto.allowOwnerRegistration);
    applyField('allowDirectBookingGlobal', dto.allowDirectBookingGlobal);
    applyField('allowWalletTopup', dto.allowWalletTopup);
    applyField('maintenanceMode', dto.maintenanceMode);
    if (dto.maintenanceMessage !== undefined) {
      applyField('maintenanceMessage', dto.maintenanceMessage.trim());
    }
    if (dto.opsNotificationEmail !== undefined) {
      applyField(
        'opsNotificationEmail',
        dto.opsNotificationEmail.trim().toLowerCase(),
      );
    }
    applyField('maxPendingPropertiesPerOwner', dto.maxPendingPropertiesPerOwner);
    applyField('chatRateLimitPerMin', dto.chatRateLimitPerMin);
    applyField('maxActiveSurveysPerUser', dto.maxActiveSurveysPerUser);
    applyField('maxDailySurveysPerUser', dto.maxDailySurveysPerUser);
    applyField('maxUnpaidBookingsPerUser', dto.maxUnpaidBookingsPerUser);
    applyField(
      'maxHourlyDirectBookingsPerUser',
      dto.maxHourlyDirectBookingsPerUser,
    );
    applyField('maxPendingTopupsPerOwner', dto.maxPendingTopupsPerOwner);
    applyField('postRateLimitPerMin', dto.postRateLimitPerMin);
    applyField('commentRateLimitPerMin', dto.commentRateLimitPerMin);
    row.updatedByUserId = actorUserId;

    const saved = await this.settingRepo.save(row);
    this._cache = {
      data: saved,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    if (changedKeys.length > 0) {
      void this.recordEvent({
        level: 'INFO',
        category: 'CONFIG',
        actorUserId,
        message: `Konfigurasi platform diperbarui (${changedKeys.join(', ')})`,
        meta: { changedKeys },
      });
    }

    return saved;
  }

  async recordEvent(params: {
    level?: 'INFO' | 'WARN' | 'ERROR';
    category: 'CONFIG' | 'BOOKING' | 'WALLET' | 'MAIL' | 'AUTH' | 'SYSTEM';
    actorUserId?: number | null;
    message: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const entity = this.logRepo.create({
        level: (params.level || 'INFO').toUpperCase(),
        category: params.category.toUpperCase(),
        actorUserId: params.actorUserId ?? null,
        message: params.message.slice(0, 1500),
        meta: this._sanitizeMeta(params.meta),
      });
      await this.logRepo.save(entity);
    } catch (err) {
      this.logger.warn(
        `Gagal menyimpan platform_event_logs: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async getEventLogs(query?: {
    level?: string;
    category?: string;
    q?: string;
    limit?: number;
  }): Promise<PlatformEventLog[]> {
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 50));
    const qb = this.logRepo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .take(limit);

    const level = (query?.level || '').trim().toUpperCase();
    if (level && level !== 'SEMUA') {
      qb.andWhere('log.level = :level', { level });
    }
    const category = (query?.category || '').trim().toUpperCase();
    if (category && category !== 'SEMUA') {
      qb.andWhere('log.category = :category', { category });
    }
    const q = (query?.q || '').trim().toLowerCase();
    if (q) {
      qb.andWhere('LOWER(log.message) LIKE :q', { q: `%${q}%` });
    }
    return qb.getMany();
  }

  async getSystemHealth() {
    const dbStart = Date.now();
    let dbConnected = false;
    let dbLatencyMs = 0;
    try {
      await this.dataSource.query('SELECT 1');
      dbConnected = true;
      dbLatencyMs = Date.now() - dbStart;
    } catch {
      dbConnected = false;
      dbLatencyMs = Date.now() - dbStart;
    }

    const mem = process.memoryUsage();
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMemMb = Math.max(0, totalMemMb - freeMemMb);

    const cpus = os.cpus();
    const cpuCores = Math.max(1, cpus.length);
    const loadAvg1m = Number(os.loadavg()[0]?.toFixed(2) || 0);
    const loadAvg5m = Number(os.loadavg()[1]?.toFixed(2) || 0);
    const loadAvg15m = Number(os.loadavg()[2]?.toFixed(2) || 0);
    const cpuUsagePercent = Math.min(
      100,
      Math.max(0, Math.round((loadAvg1m / cpuCores) * 100)),
    );

    let diskMetrics = {
      totalGb: 0,
      usedGb: 0,
      freeGb: 0,
      usagePercent: 0,
    };
    try {
      const statfs = fs.statfsSync(process.cwd());
      const blockSize = Number(statfs.bsize) || 4096;
      const totalBytes = Number(statfs.blocks) * blockSize;
      const availBytes = Number(statfs.bavail ?? statfs.bfree) * blockSize;
      const usedBytes = Math.max(0, totalBytes - availBytes);
      const gbDiv = 1024 * 1024 * 1024;
      const totalGb = Number((totalBytes / gbDiv).toFixed(1));
      const freeGb = Number((availBytes / gbDiv).toFixed(1));
      const usedGb = Number((usedBytes / gbDiv).toFixed(1));
      const usagePercent =
        totalBytes > 0
          ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)))
          : 0;
      diskMetrics = { totalGb, usedGb, freeGb, usagePercent };
    } catch {
      // Fallback if statfsSync is unavailable
    }

    const credPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      path.join(process.cwd(), 'firebase-service-account.json');
    const firebaseConfigured = fs.existsSync(credPath);

    const rawMailProvider = (process.env.MAIL_PROVIDER || '')
      .trim()
      .toLowerCase();
    const mailProvider =
      rawMailProvider ||
      (process.env.SMTP_HOST && process.env.SMTP_USER
        ? 'smtp'
        : process.env.RESEND_API_KEY
          ? 'resend'
          : 'log');

    const [error24hCount, warn24hCount] = await Promise.all([
      this.logRepo
        .createQueryBuilder('l')
        .where("l.level = 'ERROR' AND l.\"createdAt\" >= NOW() - INTERVAL '24 hours'")
        .getCount()
        .catch(() => 0),
      this.logRepo
        .createQueryBuilder('l')
        .where("l.level = 'WARN' AND l.\"createdAt\" >= NOW() - INTERVAL '24 hours'")
        .getCount()
        .catch(() => 0),
    ]);

    return {
      status: dbConnected ? 'OK' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      db: {
        connected: dbConnected,
        latencyMs: dbLatencyMs,
      },
      integrations: {
        mailProvider,
        firebaseConfigured,
        midtransProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      },
      processMemoryMb: {
        rss: Math.round(mem.rss / (1024 * 1024)),
        heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
      },
      hostMetrics: {
        cpuCores,
        loadAvg1m,
        loadAvg5m,
        loadAvg15m,
        cpuUsagePercent,
        usedMemMb,
        freeMemMb,
        totalMemMb,
      },
      diskMetrics,
      logsSummary: {
        errorsLast24h: error24hCount,
        warningsLast24h: warn24hCount,
        retentionDays: LOG_RETENTION_DAYS,
      },
    };
  }
}
