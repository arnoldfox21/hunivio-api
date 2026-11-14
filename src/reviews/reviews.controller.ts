import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

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
}
