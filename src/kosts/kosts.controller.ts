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
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { KostsService } from './kosts.service';
import { CreateKostDto } from './dto/create-kost.dto';
import { UpdateKostDto } from './dto/update-kost.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { verifyAuthToken } from '../auth/jwt.util';
import { Roles, RolesGuard } from '../auth/roles.guard';

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
    @Query('type') type?: string,
    @Query('city') city?: string,
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
    return this.kostsService.findAll({
      search,
      propertyCategory,
      type,
      city,
      facility,
      minPrice,
      maxPrice,
      onlyAvailable,
      onlyFavorite,
      sortBy,
      ownerId,
      includePending,
      approvalStatus,
      page,
      limit,
      viewerId: extractOptionalViewerId(req),
    });
  }

  @Get('map-points')
  getMapPoints(
    @Query('propertyCategory') propertyCategory?: string,
    @Query('type') type?: string,
    @Query('city') city?: string,
  ) {
    return this.kostsService.getMapPoints({ propertyCategory, type, city });
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
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.kostsService.findOne(id, extractOptionalViewerId(req));
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
  uploadImage(
    @Body()
    body: { base64?: string; filename?: string; mimeType?: string },
    @Req() req: Request,
  ) {
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
    if (buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Ukuran gambar maksimal 5 MB');
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

    const ext = isPng ? '.png' : isWebp ? '.webp' : '.jpg';

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeFileName = `kost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, safeFileName), buffer);

    const host = req.get('host');
    const url = `${req.protocol}://${host}/uploads/${safeFileName}`;
    return {
      url,
      path: `/uploads/${safeFileName}`,
    };
  }

  @UseGuards(JwtAuthGuard)
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
    return this.kostsService.update(id, updateKostDto);
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
