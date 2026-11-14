import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(
    @Body() dto: CreateBookingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.create({ ...dto, userId: req.user.userId });
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('all') all?: string,
  ) {
    const role = (req.user.role || '').toUpperCase();
    const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
    if (all === 'true') {
      if (!isStaff) {
        throw new ForbiddenException(
          'Hanya Staff atau Admin yang dapat melihat semua pengajuan.',
        );
      }
      return this.bookingsService.findAll({ all: true });
    }
    if (ownerId) {
      const oid = parseInt(ownerId, 10);
      if (!isStaff && oid !== req.user.userId) {
        throw new ForbiddenException(
          'Anda tidak dapat melihat pengajuan milik pemilik lain.',
        );
      }
      return this.bookingsService.findAll({ ownerId: oid });
    }
    const uid = userId ? parseInt(userId, 10) : req.user.userId;
    if (!isStaff && uid !== req.user.userId) {
      throw new ForbiddenException(
        'Anda tidak dapat melihat pengajuan milik pengguna lain.',
      );
    }
    return this.bookingsService.findAll({ userId: uid });
  }

  @UseGuards(RolesGuard)
  @Roles('PEMILIK_KOST', 'STAFF', 'ADMINISTRATOR')
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    return this.bookingsService.updateStatus(id, body.status);
  }

  @Patch(':id/cancel')
  cancelBooking(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.cancelBooking(id, req.user.userId);
  }

  @Post(':id/pay')
  payBooking(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { paymentMethod?: string },
  ) {
    return this.bookingsService.payBooking(id, body?.paymentMethod);
  }
}
