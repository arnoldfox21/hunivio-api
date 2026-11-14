import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { ChatsGateway } from './chats.gateway';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly chatsGateway: ChatsGateway,
  ) {}

  @Get('groups/user/:userId')
  getGroupRoomsForUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    if (userId !== req.user.userId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return this.chatsService.getGroupRoomsForUser(req.user.userId);
  }

  @Get('groups/:kostId')
  getGroupDetail(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.getGroupDetail(kostId, req.user.userId);
  }

  @Post('groups/:kostId/messages')
  createGroupMessage(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Body()
    body: {
      senderId: number;
      senderName: string;
      senderAvatar?: string;
      message: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.createGroupMessage({
      ...body,
      senderId: req.user.userId,
      kostId,
    });
  }

  @Patch('groups/:kostId/settings')
  updateGroupSettings(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Body()
    body: {
      userId: number;
      adminOnly?: boolean;
      pinnedMessageId?: number | null;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.updateGroupSettings(kostId, req.user.userId, body);
  }

  @Delete('groups/:kostId/messages/:messageId')
  deleteGroupMessage(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.deleteGroupMessage(
      kostId,
      req.user.userId,
      messageId,
    );
  }

  @Post('groups/:kostId/kick')
  kickGroupMember(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Body('targetUserId', ParseIntPipe) targetUserId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.kickGroupMember(
      kostId,
      req.user.userId,
      targetUserId,
    );
  }

  @Post('groups/:kostId/members')
  addGroupMember(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Body('targetUserId', ParseIntPipe) targetUserId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.addGroupMember(
      kostId,
      req.user.userId,
      targetUserId,
    );
  }

  @Get('groups/:kostId/candidates')
  searchGroupCandidates(
    @Param('kostId', ParseIntPipe) kostId: number,
    @Req() req: AuthenticatedRequest,
    @Query('q') query?: string,
  ) {
    return this.chatsService.searchGroupCandidates(
      kostId,
      req.user.userId,
      query,
    );
  }

  @Get('conversations/:userId')
  getConversations(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    if (userId !== req.user.userId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return this.chatsService.getConversations(req.user.userId);
  }

  @Get()
  findMessages(
    @Query('kostId', ParseIntPipe) kostId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsService.findMessages(kostId, req.user.userId);
  }

  @Post()
  async createMessage(
    @Body()
    body: {
      kostId: number;
      senderId: number;
      senderName: string;
      senderAvatar?: string;
      receiverId: number;
      message: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const saved = await this.chatsService.createMessage({
      ...body,
      senderId: req.user.userId,
    });
    return this.chatsGateway.notifyNewChatMessage(saved);
  }

  @Patch('read')
  markAsRead(
    @Body('kostId', ParseIntPipe) kostId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chatsGateway.emitMarkAsRead(kostId, req.user.userId);
  }
}
