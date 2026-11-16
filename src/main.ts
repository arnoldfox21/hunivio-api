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
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    try {
      const scriptPath = path.resolve(__dirname, '..', 'ensure-postgres.sh');
      execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('⚠️ Gagal menjalankan ensure-postgres.sh:', err);
    }
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // Lightweight per-IP rate limiter for API endpoints to prevent overload
  const ipHits = new Map<string, { count: number; resetAt: number }>();
  app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const entry = ipHits.get(ip);
    if (!entry || now > entry.resetAt) {
      ipHits.set(ip, { count: 1, resetAt: now + 60_000 });
      if (ipHits.size > 5000) {
        for (const [k, v] of ipHits) {
          if (now > v.resetAt) ipHits.delete(k);
        }
      }
      return next();
    }
    entry.count += 1;
    if (entry.count > 240) {
      return res.status(429).json({
        statusCode: 429,
        message: 'Terlalu banyak permintaan. Coba lagi sebentar.',
      });
    }
    return next();
  });
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads/',
    maxAge: '365d',
    immutable: true,
  });

  const corsOrigin = process.env.CORS_ORIGIN?.trim();
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
  console.log(`🚀 Keyloka NestJS API running on http://0.0.0.0:${port}/api`);
}
bootstrap();
