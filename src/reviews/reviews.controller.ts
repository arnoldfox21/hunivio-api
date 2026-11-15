import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findByKost(@Query('kostId', ParseIntPipe) kostId: number) {
    return this.reviewsService.findByKost(kostId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Get('reports')
  findOpenReports() {
    return this.reviewsService.findOpenReports();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Patch('reports/:reportId/dismiss')
  dismissReport(@Param('reportId', ParseIntPipe) reportId: number) {
    return this.reviewsService.dismissReport(reportId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body()
    body: {
      kostId: number;
      userId: number;
      userName: string;
      userAvatar?: string;
      ratingCleanliness: number;
      ratingSecurity: number;
      ratingAccuracy: number;
      comment: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviewsService.create({ ...body, userId: req.user.userId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PEMILIK_KOST', 'STAFF', 'ADMINISTRATOR')
  @Patch(':id/reply')
  reply(
    @Param('id', ParseIntPipe) id: number,
    @Body('reply') reply: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviewsService.replyToReview(
      id,
      req.user.userId,
      req.user.role,
      reply,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  report(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason: string; details?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reviewsService.reportReview(
      id,
      req.user.userId,
      body?.reason,
      body?.details,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.deleteReview(id);
  }
}
