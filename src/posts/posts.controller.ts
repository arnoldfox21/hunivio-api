import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreateOwnerPostDto, UpdateOwnerPostDto } from './dto/owner-post.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findByOwner(@Query('ownerId', ParseIntPipe) ownerId: number) {
    return this.postsService.findByOwner(ownerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body() dto: CreateOwnerPostDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.create({ ...dto, ownerId: req.user.userId });
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOwnerPostDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.update(id, {
      ...dto,
      requesterId: req.user.userId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.remove(id, req.user.userId);
  }
}
