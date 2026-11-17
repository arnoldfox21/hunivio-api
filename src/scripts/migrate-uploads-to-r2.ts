import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Client } from 'pg';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function extractUploadFilename(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const idx = url.indexOf('/uploads/');
  if (idx === -1) return null;
  const rest = url.slice(idx + '/uploads/'.length);
  const clean = rest.split('?')[0].split('#')[0].trim();
  return clean || null;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(
    isDryRun
      ? '🔍 Menjalankan migrasi dalam mode DRY-RUN (tidak ada perubahan ke R2/DB)...'
      : '🚀 Memulai migrasi gambar uploads/ ke Cloudflare R2...',
  );

  const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
  const bucket = process.env.R2_BUCKET_NAME?.trim() || '';
  const publicUrl = (process.env.R2_PUBLIC_URL?.trim() || '').replace(/\/+$/, '');
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error(
      'Variabel env R2 belum lengkap (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL).',
    );
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL wajib diisi di .env');
  }

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('ℹ️ Folder uploads/ tidak ditemukan. Tidak ada file untuk dimigrasi.');
    return;
  }

  const files = fs
    .readdirSync(uploadsDir)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    console.log('ℹ️ Tidak ada file gambar di folder uploads/.');
    return;
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const urlMap = new Map<string, string>();
  let totalOriginalBytes = 0;
  let totalWebpBytes = 0;

  for (const fileName of files) {
    const filePath = path.join(uploadsDir, fileName);
    const rawBuffer = fs.readFileSync(filePath);
    totalOriginalBytes += rawBuffer.length;

    let outputBuffer: Buffer;
    let outputExt = 'webp';
    let contentType = 'image/webp';
    try {
      outputBuffer = await sharp(rawBuffer, { limitInputPixels: 100_000_000 })
        .rotate()
        .resize({
          width: 1440,
          height: 1440,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch (err) {
      console.warn(
        `⚠️ Sharp gagal konversi ${fileName}, fallback ke file asli:`,
        err instanceof Error ? err.message : err,
      );
      outputBuffer = rawBuffer;
      const origExt = path.extname(fileName).replace('.', '').toLowerCase();
      outputExt = origExt === 'jpeg' ? 'jpg' : origExt;
      contentType =
        outputExt === 'png'
          ? 'image/png'
          : outputExt === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
    }

    totalWebpBytes += outputBuffer.length;
    const baseName = path.basename(fileName, path.extname(fileName));
    const key = `kosts/migrated/${baseName}.${outputExt}`;
    const newUrl = `${publicUrl}/${key}`;

    if (!isDryRun) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: outputBuffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    }

    urlMap.set(fileName, newUrl);
    console.log(
      `  ${isDryRun ? '[DRY-RUN]' : '✅'} ${fileName} (${(rawBuffer.length / 1024).toFixed(1)} KB) -> ${newUrl} (${(outputBuffer.length / 1024).toFixed(1)} KB)`,
    );
  }

  console.log(
    `📦 Total ${files.length} file: ${(totalOriginalBytes / 1024).toFixed(1)} KB -> ${(totalWebpBytes / 1024).toFixed(1)} KB`,
  );

  const needsSsl =
    process.env.DB_SSL === 'true' ||
    (process.env.DB_SSL !== 'false' &&
      (databaseUrl.includes('sslmode=require') ||
        databaseUrl.includes('sslmode=verify-full') ||
        databaseUrl.includes('ssl=true')));

  const pg = new Client({
    connectionString: databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });

  await pg.connect();
  try {
    await pg.query('BEGIN');

    // 1. Update kosts.images (jsonb array)
    const kostRes = await pg.query<{ id: number; images: unknown }>(
      `SELECT id, images FROM kosts WHERE images IS NOT NULL`,
    );
    let kostRowsUpdated = 0;
    let kostUrlsUpdated = 0;

    for (const row of kostRes.rows) {
      if (!Array.isArray(row.images)) continue;
      let changed = false;
      const nextImages = row.images.map((item) => {
        if (typeof item !== 'string') return item;
        const fname = extractUploadFilename(item);
        if (fname && urlMap.has(fname)) {
          changed = true;
          kostUrlsUpdated += 1;
          return urlMap.get(fname)!;
        }
        return item;
      });
      if (changed) {
        kostRowsUpdated += 1;
        if (!isDryRun) {
          await pg.query(`UPDATE kosts SET images = $1::jsonb WHERE id = $2`, [
            JSON.stringify(nextImages),
            row.id,
          ]);
        }
      }
    }
    console.log(
      `🗄️  kosts.images: ${kostRowsUpdated} baris (${kostUrlsUpdated} URL) ${isDryRun ? 'akan diperbarui' : 'diperbarui'}.`,
    );

    // 2. Update single-URL string columns across other tables
    const stringTargets: Array<{ table: string; column: string }> = [
      { table: 'owner_posts', column: 'imageUrl' },
      { table: 'users', column: 'avatarUrl' },
      { table: 'users', column: 'coverUrl' },
      { table: 'reviews', column: 'userAvatar' },
      { table: 'chat_messages', column: 'senderAvatar' },
      { table: 'kost_group_messages', column: 'senderAvatar' },
    ];

    for (const target of stringTargets) {
      const colCheck = await pg.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [target.table, target.column],
      );
      if (colCheck.rowCount === 0) continue;

      const rowsRes = await pg.query<{ id: number; val: string }>(
        `SELECT id, "${target.column}" AS val FROM "${target.table}" WHERE "${target.column}" LIKE '%/uploads/%'`,
      );
      let updatedCount = 0;
      for (const r of rowsRes.rows) {
        const fname = extractUploadFilename(r.val);
        if (fname && urlMap.has(fname)) {
          updatedCount += 1;
          if (!isDryRun) {
            await pg.query(
              `UPDATE "${target.table}" SET "${target.column}" = $1 WHERE id = $2`,
              [urlMap.get(fname)!, r.id],
            );
          }
        }
      }
      if (updatedCount > 0) {
        console.log(
          `🗄️  ${target.table}.${target.column}: ${updatedCount} baris ${isDryRun ? 'akan diperbarui' : 'diperbarui'}.`,
        );
      }
    }

    if (isDryRun) {
      await pg.query('ROLLBACK');
      console.log('🔍 DRY-RUN selesai (tidak ada perubahan yang disimpan).');
    } else {
      await pg.query('COMMIT');
      console.log('✅ Migrasi ke Cloudflare R2 dan update PostgreSQL selesai!');
    }
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error('❌ Migrasi gagal:', err);
  process.exit(1);
});
