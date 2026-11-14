import * as jwt from 'jsonwebtoken';

export interface AuthUserPayload {
  userId: number;
  role: string;
  email: string;
}

function getJwtSecret(): string {
  return (
    process.env.JWT_SECRET?.trim() ||
    'hunivio_dev_only_fallback_secret_change_in_prod'
  );
}

export function signAuthToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyAuthToken(token: string): AuthUserPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
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
