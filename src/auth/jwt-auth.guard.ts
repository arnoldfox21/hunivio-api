import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUserPayload, verifyAuthToken } from './jwt.util';

export interface AuthenticatedRequest extends Request {
  user: AuthUserPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token) {
      throw new UnauthorizedException(
        'Token autentikasi tidak ditemukan. Silakan masuk terlebih dahulu.',
      );
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      throw new UnauthorizedException(
        'Sesi login tidak valid atau telah kedaluwarsa. Silakan masuk ulang.',
      );
    }

    req.user = payload;
    return true;
  }
}
