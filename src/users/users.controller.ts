import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService, GOOGLE_OAUTH_CONFIG } from './users.service';
import {
  GoogleAuthDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  CompleteOnboardingDto,
  EmailLoginDto,
  SetPasswordDto,
} from './dto/google-auth.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@Controller('auth')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('google/config')
  getGoogleConfig() {
    return GOOGLE_OAUTH_CONFIG;
  }

  @Post('google')
  loginOrRegisterWithGoogle(@Body() dto: GoogleAuthDto) {
    return this.usersService.loginOrRegisterWithGoogle(dto);
  }

  @Post('login')
  loginWithEmail(@Body() dto: EmailLoginDto) {
    return this.usersService.loginWithEmail(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  setOrChangePassword(
    @Body() dto: SetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.setOrChangePassword(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    const user = await this.usersService.findOne(req.user.userId);
    return this.usersService.sanitizeUser(user, true);
  }

  @UseGuards(JwtAuthGuard)
  @Post('onboarding')
  completeOnboarding(
    @Body() dto: CompleteOnboardingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.completeOnboarding(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Get('users')
  async findAll(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const users = await this.usersService.findAll({
      search,
      role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return users.map((u) => this.usersService.sanitizeUser(u, true));
  }

  @Get('users/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findOne(id);
    return this.usersService.sanitizeUser(user, false);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('users/:id')
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const role = (req.user.role || '').toUpperCase();
    if (
      req.user.userId !== id &&
      role !== 'STAFF' &&
      role !== 'ADMINISTRATOR'
    ) {
      throw new ForbiddenException(
        'Anda tidak memiliki izin mengubah profil pengguna lain.',
      );
    }
    const updated = await this.usersService.updateProfile(
      id,
      dto,
      req.user.userId,
      role,
    );
    return this.usersService.sanitizeUser(updated, true);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR')
  @Patch('users/:id/role')
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const updated = await this.usersService.updateUserRole(id, {
      ...dto,
      requesterId: req.user.userId,
    });
    return this.usersService.sanitizeUser(updated, true);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('users/:id/fcm-token')
  updateFcmToken(
    @Param('id', ParseIntPipe) id: number,
    @Body('fcmToken') fcmToken: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user.userId !== id) {
      throw new ForbiddenException(
        'Anda tidak dapat mengubah FCM token milik pengguna lain.',
      );
    }
    return this.usersService.updateFcmToken(id, fcmToken);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF', 'ADMINISTRATOR')
  @Patch('users/:id/ban')
  async setBanStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('isBanned') isBanned: boolean,
    @Req() req: AuthenticatedRequest,
  ) {
    const updated = await this.usersService.setBanStatus(
      id,
      Boolean(isBanned),
      req.user.userId,
      req.user.role,
    );
    return this.usersService.sanitizeUser(updated, true);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('users/me')
  removeSelf(@Req() req: AuthenticatedRequest) {
    return this.usersService.remove(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR')
  @Delete('users/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.remove(id, req.user.userId);
  }
}
