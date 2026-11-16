export const INDONESIAN_WA_REGEX = /^628[0-9]{8,12}$/;
export const INDONESIAN_WA_MESSAGE =
  'Nomor WhatsApp tidak valid. Gunakan format Indonesia (contoh: 081234567890 atau 6281234567890).';

/** Normalizes Indonesian phone input to 628... or returns undefined when blank. */
export function normalizeIndonesianPhoneInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[a-zA-Z]/.test(trimmed)) return trimmed;
  let digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`;
  }
  return digits;
}
