import { BadRequestException } from '@nestjs/common';

/**
 * Validates and normalizes an Indonesian mobile/WhatsApp number to canonical `628...` digits.
 */
export function normalizeIndonesianPhoneOrThrow(
  raw: string,
  label = 'Nomor WhatsApp',
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException(`${label} wajib diisi.`);
  }
  if (/[^0-9+\s\-().]/.test(trimmed)) {
    throw new BadRequestException(
      `${label} hanya boleh berisi angka (contoh: 081234567890).`,
    );
  }
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  }
  if (!/^628[1-9][0-9]{7,11}$/.test(digits)) {
    throw new BadRequestException(
      `${label} tidak valid. Gunakan nomor Indonesia aktif (08xx / 628xx, 10–14 digit).`,
    );
  }
  return digits;
}

/**
 * Validates and normalizes an Indonesian city/regency name.
 */
export function normalizeCityNameOrThrow(raw: string): string {
  let normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new BadRequestException('Kota / Kabupaten wajib diisi.');
  }
  normalized = normalized.replace(/^kab\.?\s+/i, 'Kabupaten ').trim();
  if (normalized.length < 3 || normalized.length > 80) {
    throw new BadRequestException(
      'Nama kota/kabupaten harus terdiri dari 3–80 karakter.',
    );
  }
  if (!/^[a-zA-Z\s.\-']+$/.test(normalized)) {
    throw new BadRequestException(
      'Nama kota/kabupaten hanya boleh berisi huruf, spasi, titik, atau tanda hubung.',
    );
  }
  const letterCount = (normalized.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < 3) {
    throw new BadRequestException(
      'Masukkan nama kota/kabupaten yang lengkap (minimal 3 huruf).',
    );
  }
  return normalized;
}

/**
 * Validates and normalizes an optional username (3–30 chars: lowercase letters, digits, `.`, `_`).
 */
export function normalizeUsernameOrThrow(raw: string): string {
  const normalized = raw.trim().replace(/^@+/, '').toLowerCase();
  if (!normalized) return '';
  if (
    normalized.length < 3 ||
    normalized.length > 30 ||
    !/^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(normalized) ||
    /(\.\.|__)/.test(normalized)
  ) {
    throw new BadRequestException(
      'Username harus 3–30 karakter (huruf kecil, angka, titik, atau underscore, tanpa titik/underscore berurutan).',
    );
  }
  return normalized;
}
