import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PlatformService } from './platform.service';
import { UpdatePlatformConfigDto } from './dto/update-platform-config.dto';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRATOR')
@Controller('admin/platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('config')
  getConfig() {
    return this.platformService.getSettings();
  }

  @Patch('config')
  updateConfig(
    @Body() dto: UpdatePlatformConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.platformService.updateSettings(dto, req.user.userId);
  }

  @Get('system-health')
  getSystemHealth() {
    return this.platformService.getSystemHealth();
  }

  @Get('logs')
  getEventLogs(
    @Query('level') level?: string,
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platformService.getEventLogs({
      level,
      category,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
