import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService, GOOGLE_OAUTH_CONFIG } from './users.service';
import { GoogleAuthDto, UpdateUserDto } from './dto/google-auth.dto';

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

  @Get('users')
  findAll() {
    return this.usersService.findAll();
  }

  @Get('users/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch('users/:id')
  updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(id, dto);
  }

  @Delete('users/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}
