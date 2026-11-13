import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { KostsService } from './kosts.service';
import { CreateKostDto } from './dto/create-kost.dto';

@Controller('kosts')
export class KostsController {
  constructor(private readonly kostsService: KostsService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('city') city?: string,
    @Query('facility') facility?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    return this.kostsService.findAll({
      search,
      type,
      city,
      facility,
      minPrice,
      maxPrice,
      sortBy,
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.kostsService.findOne(id);
  }

  @Patch(':id/favorite')
  toggleFavorite(@Param('id', ParseIntPipe) id: number) {
    return this.kostsService.toggleFavorite(id);
  }

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

    const extFromMime =
      body.mimeType === 'image/png'
        ? '.png'
        : body.mimeType === 'image/webp'
          ? '.webp'
          : '.jpg';
    const extFromName = body.filename ? path.extname(body.filename) : '';
    const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(
      extFromName.toLowerCase(),
    )
      ? extFromName.toLowerCase()
      : extFromMime;

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

  @Post()
  create(@Body() createKostDto: CreateKostDto) {
    return this.kostsService.create(createKostDto);
  }
}
