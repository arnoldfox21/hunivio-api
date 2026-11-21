import 'reflect-metadata';
import 'dotenv/config';
process.env.TZ = 'UTC';
import { types } from 'pg';

// PostgreSQL menyimpan `timestamp without time zone` (OID 1114) dalam UTC;
// pastikan node-postgres mem-parse-nya sebagai UTC agar tidak bergeser 7 jam (WIB).
types.setTypeParser(1114, (str: string) =>
  new Date(str.endsWith('Z') ? str : `${str.replace(' ', 'T')}Z`),
);

import { execSync } from 'child_process';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import * as express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { PlatformService } from './platform/platform.service';

async function bootstrap() {
  const bootstrapLogger = new NestLogger('Bootstrap');
  if (!process.env.DATABASE_URL) {
    try {
      const scriptPath = path.resolve(__dirname, '..', 'ensure-postgres.sh');
      execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
    } catch (err) {
      bootstrapLogger.error('Gagal menjalankan ensure-postgres.sh', err);
    }
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // Extract real client IP from proxy headers (x-client-ip / x-forwarded-for) before falling back to socket IP
  const extractClientIp = (req: express.Request): string => {
    const clientIpHeader = req.headers['x-client-ip'];
    const rawClientIp = Array.isArray(clientIpHeader)
      ? clientIpHeader[0]
      : clientIpHeader;
    if (rawClientIp && rawClientIp.trim() && rawClientIp.trim() !== 'unknown') {
      return rawClientIp.trim();
    }
    const forwardedFor = req.headers['x-forwarded-for'];
    const firstForwarded = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim()
        : undefined;
    if (firstForwarded && firstForwarded !== 'unknown') {
      return firstForwarded;
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  };

  const platformService = app.get(PlatformService, { strict: false });

  // Lightweight per-IP (or IP+token) rate limiter helper to prevent overload & abuse
  const createIpRateLimiter = (
    windowMs: number,
    maxRequests: number | (() => number),
    message: string,
    includeAuthKey = false,
  ): express.RequestHandler => {
    const hits = new Map<string, { count: number; resetAt: number }>();
    return (req, res, next) => {
      const now = Date.now();
      const ip = extractClientIp(req);
      const authHeader = includeAuthKey
        ? String(req.headers.authorization || '').slice(-24)
        : '';
      const bucketKey = authHeader ? `${ip}:${authHeader}` : ip;
      const entry = hits.get(bucketKey);
      if (!entry || now > entry.resetAt) {
        hits.set(bucketKey, { count: 1, resetAt: now + windowMs });
        if (hits.size > 5000) {
          for (const [k, v] of hits) {
            if (now > v.resetAt) hits.delete(k);
          }
        }
        return next();
      }
      entry.count += 1;
      const limit =
        typeof maxRequests === 'function' ? maxRequests() : maxRequests;
      if (entry.count > limit) {
        return res.status(429).json({
          statusCode: 429,
          message,
        });
      }
      return next();
    };
  };

  app.use(
    '/api/auth/login',
    createIpRateLimiter(
      60_000,
      20,
      'Terlalu banyak percobaan login. Tunggu 1 menit sebelum mencoba lagi.',
    ),
  );
  app.use(
    '/api/auth/google',
    createIpRateLimiter(
      60_000,
      20,
      'Terlalu banyak percobaan login Google. Tunggu 1 menit sebelum mencoba lagi.',
    ),
  );
  app.use(
    '/api/kosts/:id/report',
    createIpRateLimiter(
      60_000,
      10,
      'Terlalu banyak pengiriman laporan. Tunggu 1 menit sebelum mencoba lagi.',
    ),
  );
  const chatSpamLimiter = createIpRateLimiter(
    60_000,
    () => platformService?.getCachedSettingsSync()?.chatRateLimitPerMin ?? 12,
    'Terlalu banyak pesan dikirim dalam waktu singkat. Tunggu 1 menit sebelum mengirim lagi.',
    true,
  );
  const chatSpamPostOnly: express.RequestHandler = (req, res, next) =>
    req.method === 'POST' ? chatSpamLimiter(req, res, next) : next();
  app.use('/api/chats', chatSpamPostOnly);
  app.use('/api/chats/groups/:kostId/messages', chatSpamPostOnly);

  const postWriteLimiter = createIpRateLimiter(
    60_000,
    15,
    'Terlalu banyak pengiriman postingan/komentar dalam waktu singkat. Tunggu 1 menit.',
    true,
  );
  app.use('/api/posts', (req, res, next) =>
    req.method === 'POST' ? postWriteLimiter(req, res, next) : next(),
  );

  const bookingWriteLimiter = createIpRateLimiter(
    60_000,
    10,
    'Terlalu banyak pengajuan survei atau booking dalam waktu singkat. Tunggu 1 menit.',
    true,
  );
  app.use('/api/bookings', (req, res, next) =>
    req.method === 'POST' ? bookingWriteLimiter(req, res, next) : next(),
  );

  const reviewWriteLimiter = createIpRateLimiter(
    60_000,
    10,
    'Terlalu banyak pengiriman ulasan atau laporan dalam waktu singkat. Tunggu 1 menit.',
    true,
  );
  app.use('/api/reviews', (req, res, next) =>
    req.method === 'POST' ? reviewWriteLimiter(req, res, next) : next(),
  );

  app.use(
    '/api',
    createIpRateLimiter(
      60_000,
      600,
      'Terlalu banyak permintaan. Coba lagi sebentar.',
      true,
    ),
  );
  app.use('/api/kosts/upload-image', express.json({ limit: '15mb' }));
  app.use('/api/kosts', express.json({ limit: '15mb' }));
  app.use('/api/posts', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    bootstrapLogger.warn(
      'CORS_ORIGIN belum diset di production; CORS fallback ke wildcard (*).',
    );
  }
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  bootstrapLogger.log(
    `Keyloka NestJS API running on http://0.0.0.0:${port}/api`,
  );
}
bootstrap();
