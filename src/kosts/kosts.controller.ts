import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  Req,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { KostsService } from './kosts.service';
import { CreateKostDto } from './dto/create-kost.dto';
import { UpdateKostDto } from './dto/update-kost.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { verifyAuthToken } from '../auth/jwt.util';
import { Roles, RolesGuard } from '../auth/roles.guard';

const UPLOAD_RATE_WINDOW_MS = 60_000;
const UPLOAD_RATE_MAX_REQUESTS = 20;
const uploadRateHits = new Map<number, { count: number; resetAt: number }>();

function checkUploadRateLimit(userId: number): void {
  const now = Date.now();
  const entry = uploadRateHits.get(userId);
  if (!entry || now > entry.resetAt) {
    uploadRateHits.set(userId, {
      count: 1,
      resetAt: now + UPLOAD_RATE_WINDOW_MS,
    });
    if (uploadRateHits.size > 2000) {
      for (const [k, v] of uploadRateHits) {
        if (now > v.resetAt) uploadRateHits.delete(k);
      }
    }
    return;
  }
  entry.count += 1;
  if (entry.count > UPLOAD_RATE_MAX_REQUESTS) {
    throw new HttpException(
      'Terlalu banyak upload gambar. Tunggu 1 menit sebelum mencoba lagi.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function extractOptionalViewerId(req: Request): number | undefined {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return undefined;
  const payload = verifyAuthToken(auth.slice(7).trim());
  return payload?.userId;
}

@Controller('kosts')
export class KostsController {
  constructor(private readonly kostsService: KostsService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('propertyCategory') propertyCategory?: string,
    @Query('unitType') unitType?: string,
    @Query('type') type?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
    @Query('facility') facility?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('onlyAvailable') onlyAvailable?: string,
    @Query('onlyFavorite') onlyFavorite?: string,
    @Query('sortBy') sortBy?: string,
    @Query('ownerId') ownerId?: string,
    @Query('includePending') includePending?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const authUser = token ? verifyAuthToken(token) : null;
    const role = (authUser?.role || '').toUpperCase();
    const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
    const isOwnFilter =
      Boolean(authUser?.userId) &&
      Boolean(ownerId) &&
      Number(ownerId) === authUser?.userId;
    const canSeeUnapproved = isStaff || isOwnFilter;

    return this.kostsService.findAll({
      search,
      propertyCategory,
      unitType,
      type,
      city,
      district,
      facility,
      minPrice,
      maxPrice,
      onlyAvailable,
      onlyFavorite,
      sortBy,
      ownerId,
      includePending: canSeeUnapproved ? includePending : undefined,
      approvalStatus: canSeeUnapproved ? approvalStatus : undefined,
      page,
      limit,
      viewerId: authUser?.userId,
    });
  }

  @Get('map-points')
  getMapPoints(
    @Query('propertyCategory') propertyCategory?: string,
    @Query('unitType') unitType?: string,
    @Query('type') type?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
  ) {
    return this.kostsService.getMapPoints({
      propertyCategory,
      unitType,
      type,
      city,
      district,
    });
  }

  @Get('cities')
  getCities() {
    return this.kostsService.getCities();
  }

  @Get('filters')
  getFilters() {
    return this.kostsService.getFilters();
  }

  @Get('master-facilities')
  getMasterFacilities() {
    return this.kostsService.getMasterFacilities();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const authUser = token ? verifyAuthToken(token) : null;
    const kost = await this.kostsService.findOne(id, authUser?.userId);
    const approval = (kost.approvalStatus || 'APPROVED').toUpperCase();
    if (approval !== 'APPROVED') {
      const role = (authUser?.role || '').toUpperCase();
      const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
      const isOwner = Boolean(authUser?.userId) && kost.ownerId === authUser?.userId;
      if (!isStaff && !isOwner) {
        throw new NotFoundException('Properti tidak ditemukan.');
      }
    }
    return kost;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/favorite')
  toggleFavorite(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kostsService.toggleFavorite(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload-image')
  async uploadImage(
    @Body()
    body: { base64?: string; filename?: string; mimeType?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    checkUploadRateLimit(req.user.userId);

    const rawBase64 = body?.base64?.trim();
    if (!rawBase64) {
      throw new BadRequestException('Data gambar base64 wajib diisi');
    }

    const base64Data = rawBase64.includes(',')
      ? rawBase64.split(',').pop() || ''
      : rawBase64;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException('Format gambar tidak valid');
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Ukuran gambar mentah maksimal 8 MB');
    }

    const isJpeg =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const isPng =
      buffer.length >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const isWebp =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      throw new BadRequestException(
        'File bukan gambar JPEG, PNG, atau WebP yang valid',
      );
    }

    let compressedBuffer: Buffer;
    try {
      compressedBuffer = await sharp(buffer, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        'Gambar rusak, dimensi terlalu besar, atau tidak dapat diproses.',
      );
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeFileName = `kost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.webp`;
    fs.writeFileSync(path.join(uploadsDir, safeFileName), compressedBuffer);

    const host = req.get('host');
    const url = `${req.protocol}://${host}/uploads/${safeFileName}`;
    return {
      url,
      path: `/uploads/${safeFileName}`,
      sizeBytes: compressedBuffer.length,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PEMILIK_KOST', 'STAFF', 'ADMINISTRATOR')
  @Post()
  create(
    @Body() createKostDto: CreateKostDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.role || '').toUpperCase();
    const ownerId =
      (role === 'STAFF' || role === 'ADMINISTRATOR') && createKostDto.ownerId
        ? createKostDto.ownerId
        : req.user.userId;
    return this.kostsService.create({ ...createKostDto, ownerId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Patch(':id/approval')
  updateApproval(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      status?: string;
      approvalStatus?: string;
      rejectionReason?: string;
      reviewerId?: number;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kostsService.updateApproval(
      id,
      body.status || body.approvalStatus || '',
      body.rejectionReason,
      req.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Patch(':id/transfer-owner')
  transferOwner(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { targetOwnerId: number },
  ) {
    return this.kostsService.transferOwner(id, Number(body.targetOwnerId));
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateKostDto: UpdateKostDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const existing = await this.kostsService.findOne(id);
    const role = (req.user.role || '').toUpperCase();
    if (
      existing.ownerId !== req.user.userId &&
      role !== 'STAFF' &&
      role !== 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin mengubah properti ini.',
      );
    }
    const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
    const payload = { ...updateKostDto };
    if (!isStaff) {
      delete payload.allowDirectBooking;
      delete payload.isVerified;
      delete payload.ownerId;
      delete (payload as Record<string, unknown>).approvalStatus;
      delete (payload as Record<string, unknown>).rejectionReason;
    }
    return this.kostsService.update(id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const existing = await this.kostsService.findOne(id);
    const role = (req.user.role || '').toUpperCase();
    if (
      existing.ownerId !== req.user.userId &&
      role !== 'STAFF' &&
      role !== 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin menghapus properti ini.',
      );
    }
    return this.kostsService.remove(id);
  }
}
