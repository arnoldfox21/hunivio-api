import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface UploadResult {
  url: string;
  key: string;
  sizeBytes: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
    this.bucket = process.env.R2_BUCKET_NAME?.trim() || '';
    this.publicUrl = (process.env.R2_PUBLIC_URL?.trim() || '').replace(/\/+$/, '');

    if (accountId && accessKeyId && secretAccessKey && this.bucket && this.publicUrl) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } else {
      this.client = null;
      this.logger.warn(
        'Konfigurasi Cloudflare R2 belum lengkap (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL). Upload akan gagal hingga variabel env diset.',
      );
    }
  }

  /**
   * Builds a date-partitioned object key for kost images, e.g. kosts/2026/11/kost_...webp
   */
  buildKostImageKey(ext: string): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const cleanExt = ext.replace(/^\./, '').toLowerCase();
    const rand = Math.random().toString(36).slice(2, 8);
    return `kosts/${year}/${month}/kost_${Date.now()}_${rand}.${cleanExt}`;
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (!this.client) {
      throw new InternalServerErrorException(
        'Cloudflare R2 storage belum dikonfigurasi pada server.',
      );
    }

    const cleanKey = key.replace(/^\/+/, '');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      url: `${this.publicUrl}/${cleanKey}`,
      key: cleanKey,
      sizeBytes: buffer.length,
    };
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!this.client || !url || !this.publicUrl) return;
    const prefix = `${this.publicUrl}/`;
    if (!url.startsWith(prefix)) return;

    const key = url.slice(prefix.length).split('?')[0];
    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Gagal menghapus objek R2 (${key}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
