export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface KeylokaEmailInput {
  subject: string;
  title: string;
  greetingName?: string;
  intro: string;
  details?: EmailDetailRow[];
  ctaLabel?: string;
  ctaUrl?: string;
  badgeText?: string;
  badgeTone?: 'emerald' | 'amber' | 'red' | 'blue';
  outroNote?: string;
}

export function escapeHtml(raw: string | number | null | undefined): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BADGE_STYLES: Record<
  NonNullable<KeylokaEmailInput['badgeTone']>,
  { bg: string; fg: string }
> = {
  emerald: { bg: '#d1fae5', fg: '#065f46' },
  amber: { bg: '#fef3c7', fg: '#92400e' },
  red: { bg: '#fee2e2', fg: '#991b1b' },
  blue: { bg: '#dbeafe', fg: '#1e40af' },
};

export function renderKeylokaEmail(input: KeylokaEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = escapeHtml(input.greetingName || 'Sahabat Keyloka');
  const safeTitle = escapeHtml(input.title);
  const safeIntro = escapeHtml(input.intro);
  const badge = input.badgeText
    ? BADGE_STYLES[input.badgeTone || 'emerald']
    : null;

  const detailRowsHtml = (input.details || [])
    .map(
      (row) => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 12px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #f3f4f6;vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');

  const detailsBlock = detailRowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e7eb;border-radius:10px;border-collapse:collapse;overflow:hidden;">${detailRowsHtml}</table>`
    : '';

  const ctaBlock =
    input.ctaLabel && input.ctaUrl
      ? `<div style="margin:24px 0 8px;">
          <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background-color:#059669;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">
            ${escapeHtml(input.ctaLabel)}
          </a>
        </div>`
      : '';

  const outroBlock = input.outroNote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#4b5563;">${escapeHtml(input.outroNote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="background:#059669;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.3px;">
              Keyloka
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              ${
                badge && input.badgeText
                  ? `<span style="display:inline-block;background:${badge.bg};color:${badge.fg};font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;margin-bottom:12px;">${escapeHtml(input.badgeText)}</span>`
                  : ''
              }
              <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111827;font-weight:800;">${safeTitle}</h1>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151;">Halo <strong>${safeName}</strong>,</p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${safeIntro}</p>
              ${detailsBlock}
              ${ctaBlock}
              ${outroBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">
              <strong>Keamanan Transaksi:</strong> Jangan pernah mentransfer pembayaran DP atau sewa di luar sistem Escrow resmi Keyloka.<br />
              Email ini dikirim otomatis oleh sistem Keyloka. Mohon tidak membalas email ini.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const detailLines = (input.details || [])
    .map((r) => `- ${r.label}: ${r.value}`)
    .join('\n');
  const text = [
    `Halo ${input.greetingName || 'Sahabat Keyloka'},`,
    '',
    input.title,
    input.intro,
    detailLines ? `\n${detailLines}` : '',
    input.ctaUrl ? `\nBuka di Keyloka: ${input.ctaUrl}` : '',
    input.outroNote ? `\n${input.outroNote}` : '',
    '',
    '---',
    'Keamanan Transaksi: Jangan transfer di luar sistem Escrow resmi Keyloka.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: input.subject, html, text };
}
