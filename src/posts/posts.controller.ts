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
import {
  CreateOwnerPostDto,
  CreatePostCommentDto,
  UpdateOwnerPostDto,
} from './dto/owner-post.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findByOwner(
    @Query('ownerId', ParseIntPipe) ownerId: number,
    @Query('viewerId') viewerId?: string,
  ) {
    const parsedViewerId = viewerId ? parseInt(viewerId, 10) : undefined;
    return this.postsService.findByOwner(
      ownerId,
      Number.isFinite(parsedViewerId) ? parsedViewerId : undefined,
    );
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

  @Get(':id/comments')
  getComments(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.getComments(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePostCommentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.addComment(id, req.user.userId, dto.content);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/comments/:commentId')
  removeComment(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.removeComment(id, commentId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  toggleLike(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.postsService.toggleLike(id, req.user.userId);
  }
}
