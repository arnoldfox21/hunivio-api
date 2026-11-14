import {
  Controller,
  Get,
  Post,
  Patch,
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
}
