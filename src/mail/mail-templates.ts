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
  preheader?: string;
  frontendUrl?: string;
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
  { bg: string; fg: string; border: string }
> = {
  emerald: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
  amber: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
  red: { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' },
  blue: { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
};

export function renderKeylokaEmail(input: KeylokaEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const baseUrl = (input.frontendUrl || 'https://keyloka.com').replace(/\/+$/, '');
  const logoUrl = `${baseUrl}/images/keyloka_logo.png`;
  const safeName = escapeHtml(input.greetingName || 'Sahabat Keyloka');
  const safeTitle = escapeHtml(input.title);
  const safeIntro = escapeHtml(input.intro);
  const safePreheader = escapeHtml(input.preheader || input.intro);
  const badge = input.badgeText
    ? BADGE_STYLES[input.badgeTone || 'emerald']
    : null;
  const year = new Date().getUTCFullYear();

  const detailRowsHtml = (input.details || [])
    .map(
      (row, idx) => `
      <tr style="background-color:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding:11px 14px;font-size:13px;line-height:1.45;color:#64748b;border-bottom:1px solid #e2e8f0;width:40%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:11px 14px;font-size:13px;line-height:1.45;color:#0f172a;font-weight:700;border-bottom:1px solid #e2e8f0;vertical-align:top;font-variant-numeric:tabular-nums;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');

  const detailsBlock = detailRowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        <tr>
          <td colspan="2" style="padding:10px 14px;background-color:#f1f5f9;font-size:11px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#475569;border-bottom:1px solid #e2e8f0;">
            Ringkasan Aktivitas
          </td>
        </tr>
        ${detailRowsHtml}
      </table>`
    : '';

  const ctaBlock =
    input.ctaLabel && input.ctaUrl
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 6px;">
          <tr>
            <td>
              <a href="${escapeHtml(input.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#059669;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;line-height:1;padding:14px 24px;border-radius:10px;">
                ${escapeHtml(input.ctaLabel)} &rarr;
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding-top:12px;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all;">
              Jika tombol tidak berfungsi, buka tautan berikut di browser Anda:<br />
              <a href="${escapeHtml(input.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="color:#059669;text-decoration:underline;">${escapeHtml(input.ctaUrl)}</a>
            </td>
          </tr>
        </table>`
      : '';

  const outroBlock = input.outroNote
    ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.65;color:#475569;">${escapeHtml(input.outroNote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Hidden Inbox Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${safePreheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.05);">
          <!-- Top Accent Bar -->
          <tr>
            <td style="height:4px;background-color:#059669;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Brand Header -->
          <tr>
            <td style="padding:20px 28px;border-bottom:1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <a href="${escapeHtml(baseUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;">
                      <img src="${escapeHtml(logoUrl)}" alt="Keyloka" width="32" height="32" style="display:inline-block;border-radius:8px;vertical-align:middle;border:0;" />
                      <span style="margin-left:10px;font-size:19px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;vertical-align:middle;">Key<span style="color:#059669;">loka</span></span>
                    </a>
                  </td>
                  <td align="right" style="vertical-align:middle;font-size:11px;font-weight:600;color:#64748b;">
                    Notifikasi Resmi
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:28px;">
              ${
                badge && input.badgeText
                  ? `<span style="display:inline-block;background-color:${badge.bg};color:${badge.fg};border:1px solid ${badge.border};font-size:11px;font-weight:700;letter-spacing:0.2px;padding:4px 11px;border-radius:999px;margin-bottom:14px;">${escapeHtml(input.badgeText)}</span>`
                  : ''
              }
              <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#0f172a;font-weight:800;letter-spacing:-0.3px;">${safeTitle}</h1>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.65;color:#334155;">Halo <strong>${safeName}</strong>,</p>
              <p style="margin:0;font-size:14px;line-height:1.65;color:#334155;">${safeIntro}</p>

              ${detailsBlock}
              ${ctaBlock}
              ${outroBlock}

              <!-- Security Callout -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                <tr>
                  <td style="padding:12px 14px;font-size:12px;line-height:1.55;color:#92400e;">
                    <strong>Keamanan Transaksi Keyloka:</strong> Jangan pernah mentransfer DP atau biaya sewa ke rekening pribadi di luar sistem Escrow resmi Keyloka. Keyloka tidak pernah meminta PIN, OTP, atau password Anda melalui email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:11.5px;line-height:1.6;color:#64748b;">
              <p style="margin:0 0 6px;">
                Email ini dikirim otomatis oleh sistem <strong>Keyloka</strong>. Mohon tidak membalas email ini.
              </p>
              <p style="margin:0;">
                &copy; ${year} Keyloka &bull;
                <a href="${escapeHtml(baseUrl)}/faq" target="_blank" rel="noopener noreferrer" style="color:#475569;text-decoration:underline;">Bantuan &amp; FAQ</a> &bull;
                <a href="${escapeHtml(baseUrl)}/syarat-ketentuan" target="_blank" rel="noopener noreferrer" style="color:#475569;text-decoration:underline;">Syarat &amp; Ketentuan</a> &bull;
                <a href="${escapeHtml(baseUrl)}/kebijakan-privasi" target="_blank" rel="noopener noreferrer" style="color:#475569;text-decoration:underline;">Privasi</a>
              </p>
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
    `KEYLOKA - Notifikasi Resmi`,
    `========================================`,
    `Halo ${input.greetingName || 'Sahabat Keyloka'},`,
    '',
    input.title,
    input.intro,
    detailLines ? `\nRingkasan Aktivitas:\n${detailLines}` : '',
    input.ctaUrl ? `\n${input.ctaLabel || 'Buka di Keyloka'}: ${input.ctaUrl}` : '',
    input.outroNote ? `\n${input.outroNote}` : '',
    '',
    '----------------------------------------',
    'Keamanan Transaksi: Jangan transfer di luar sistem Escrow resmi Keyloka.',
    `© ${year} Keyloka • ${baseUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: input.subject, html, text };
}
