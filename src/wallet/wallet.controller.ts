import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateTopupDto } from './dto/create-topup.dto';
import { CreatePayoutRequestDto } from './dto/create-payout-request.dto';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('pricing')
  getPricing() {
    return this.walletService.getPricing();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyWallet(@Req() req: AuthenticatedRequest) {
    return this.walletService.getWalletSummary(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('boost/:kostId')
  boostKost(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Body('packageCode') packageCode: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.walletService.boostKost(
      req.user.userId,
      kostId,
      packageCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('topup')
  createTopup(
    @Body() dto: CreateTopupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.walletService.createTopup(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('topup/:orderId/sync')
  syncTopupStatus(
    @Param('orderId') orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.walletService.syncTopupStatus(req.user.userId, orderId);
  }

  @Post('duitku-callback')
  @HttpCode(200)
  handleDuitkuCallback(@Body() payload: Record<string, unknown>) {
    return this.walletService.handleDuitkuCallback(payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('payout-requests')
  createPayoutRequest(
    @Body() body: CreatePayoutRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.walletService.createPayoutRequest(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payout-requests/me')
  getMyPayoutRequests(@Req() req: AuthenticatedRequest) {
    return this.walletService.getMyPayoutRequests(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Get('payout-requests')
  getAllPayoutRequests() {
    return this.walletService.getAllPayoutRequests();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Patch('payout-requests/:id/process')
  processPayoutRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      action: 'APPROVE' | 'REJECT';
      adminNote?: string;
      revisedAmount?: number;
    },
  ) {
    return this.walletService.processPayoutRequest(
      id,
      body.action,
      body.adminNote,
      body.revisedAmount,
    );
  }
}
