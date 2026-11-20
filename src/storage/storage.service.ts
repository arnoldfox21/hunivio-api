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

  /**
   * Normalizes a stored image value: if it is a relative R2 key/path
   * (e.g. `/kosts/...` or `kosts/...`) and `R2_PUBLIC_URL` is configured,
   * returns the full public URL; otherwise returns the trimmed value as-is.
   */
  resolvePublicUrl(value: string): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || !this.publicUrl) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (
      trimmed.startsWith('/kosts/') ||
      trimmed.startsWith('kosts/') ||
      trimmed.startsWith('/articles/') ||
      trimmed.startsWith('articles/')
    ) {
      return `${this.publicUrl}/${trimmed.replace(/^\/+/, '')}`;
    }
    return trimmed;
  }

  /**
   * Extracts R2-managed image URLs/paths referenced in HTML `src="..."` attributes.
   */
  extractManagedImageUrlsFromHtml(html: string | null | undefined): string[] {
    if (!html) return [];
    const results = new Set<string>();
    const prefix = this.publicUrl ? `${this.publicUrl}/` : '';
    const srcRegex = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
    let match: RegExpExecArray | null;
    while ((match = srcRegex.exec(html)) !== null) {
      const url = (match[1] ?? match[2] ?? '').trim();
      if (!url) continue;
      if (
        (prefix && url.startsWith(prefix)) ||
        url.startsWith('/kosts/') ||
        url.startsWith('kosts/') ||
        url.startsWith('/articles/') ||
        url.startsWith('articles/')
      ) {
        results.add(url);
      }
    }
    return Array.from(results);
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!this.client || !url) return;

    const trimmed = url.trim();
    let key = '';
    const prefix = this.publicUrl ? `${this.publicUrl}/` : '';
    if (prefix && trimmed.startsWith(prefix)) {
      key = trimmed.slice(prefix.length).split('?')[0];
    } else if (trimmed.startsWith('/kosts/') || trimmed.startsWith('/articles/')) {
      key = trimmed.slice(1).split('?')[0];
    } else if (trimmed.startsWith('kosts/') || trimmed.startsWith('articles/')) {
      key = trimmed.split('?')[0];
    }
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
