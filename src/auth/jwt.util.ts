import * as jwt from 'jsonwebtoken';

export interface AuthUserPayload {
  userId: number;
  role: string;
  email: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET wajib dikonfigurasi di environment production.');
  }
  return 'keyloka_dev_only_fallback_secret_change_in_prod';
}

export function signAuthToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
}

export function verifyAuthToken(token: string): AuthUserPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    const userId = Number(decoded.userId);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return {
      userId,
      role: String(decoded.role || 'PENYEWA').toUpperCase(),
      email: String(decoded.email || ''),
    };
  } catch {
    return null;
  }
}
