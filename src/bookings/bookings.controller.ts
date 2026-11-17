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
import {
  CreateBookingDto,
  CreateDirectBookingDto,
} from './dto/create-booking.dto';
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

  @Get('loyalty/me')
  getMyLoyalty(@Req() req: AuthenticatedRequest) {
    return this.bookingsService.getMyLoyaltySummary(req.user.userId);
  }

  @Post('direct')
  createDirect(
    @Body() body: CreateDirectBookingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.createDirectBooking({
      userId: req.user.userId,
      kostId: body.kostId,
      tenantName: body.tenantName.trim(),
      tenantPhone: body.tenantPhone.trim(),
      startDate: body.startDate.trim(),
      durationCount: body.durationCount,
      notes: body.notes,
      usePoints: Boolean(body.usePoints),
      paymentScheme: body.paymentScheme,
    });
  }

  @Post(':id/sync-payment')
  syncPayment(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.syncDirectBookingPayment(
      id,
      req.user.userId,
      req.user.role,
    );
  }

  @Post(':id/confirm-checkin')
  confirmCheckIn(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.confirmCheckIn(id, req.user.userId);
  }

  @Post(':id/dispute')
  reportDispute(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.reportDispute(id, req.user.userId, reason);
  }

  @UseGuards(RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Post(':id/resolve-dispute')
  resolveDispute(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution') resolution: 'RELEASE' | 'REFUND',
  ) {
    return this.bookingsService.resolveDispute(id, resolution);
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('all') all?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const role = (req.user.role || '').toUpperCase();
    const isStaff = role === 'STAFF' || role === 'ADMINISTRATOR';
    if (all === 'true') {
      if (!isStaff) {
        throw new ForbiddenException(
          'Hanya Staff atau Admin yang dapat melihat semua pengajuan.',
        );
      }
      return this.bookingsService.findAll({
        all: true,
        page: parsedPage,
        limit: parsedLimit,
      });
    }
    if (ownerId) {
      const oid = parseInt(ownerId, 10);
      if (!isStaff && oid !== req.user.userId) {
        throw new ForbiddenException(
          'Anda tidak dapat melihat pengajuan milik pemilik lain.',
        );
      }
      return this.bookingsService.findAll({
        ownerId: oid,
        page: parsedPage,
        limit: parsedLimit,
      });
    }
    const uid = userId ? parseInt(userId, 10) : req.user.userId;
    if (!isStaff && uid !== req.user.userId) {
      throw new ForbiddenException(
        'Anda tidak dapat melihat pengajuan milik pengguna lain.',
      );
    }
    return this.bookingsService.findAll({
      userId: uid,
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @UseGuards(RolesGuard)
  @Roles('PEMILIK_KOST', 'STAFF', 'ADMINISTRATOR')
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.updateStatus(
      id,
      body.status,
      req.user.userId,
      req.user.role,
    );
  }

  @Patch(':id/cancel')
  cancelBooking(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.cancelBooking(
      id,
      req.user.userId,
      req.user.role,
    );
  }
}
