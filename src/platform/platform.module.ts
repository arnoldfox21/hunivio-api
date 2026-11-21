import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PlatformEventLog } from './entities/platform-event-log.entity';
import { PlatformService } from './platform.service';
import {
  PlatformController,
  PlatformPublicController,
} from './platform.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PlatformSetting, PlatformEventLog])],
  controllers: [PlatformController, PlatformPublicController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
