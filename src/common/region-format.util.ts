export function toTitleCaseRegion(value?: string | null): string {
  const cleaned = (value || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned
    .toLowerCase()
    .replace(
      /(^|[\s\-/,(])([a-z\u00C0-\u024F])/g,
      (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
    );
}
