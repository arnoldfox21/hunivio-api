import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { AuthUserPayload, verifyAuthToken } from './jwt.util';

export interface AuthenticatedRequest extends Request {
  user: AuthUserPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (this.dataSource) {
      const rows = (await this.dataSource.query(
        'SELECT "isBanned" FROM users WHERE id = $1 LIMIT 1',
        [payload.userId],
      )) as Array<{ isBanned?: boolean }>;
      if (rows.length === 0 || rows[0]?.isBanned === true) {
        throw new UnauthorizedException(
          'Akun Anda telah dibanned. Sesi Anda dihentikan.',
        );
      }
    }

    req.user = payload;
    return true;
  }
}
