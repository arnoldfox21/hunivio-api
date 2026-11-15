import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './entities/chat-message.entity';
import { KostGroupMessage } from './entities/kost-group-message.entity';
import { KostGroupSetting } from './entities/kost-group-setting.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { User } from '../users/entities/user.entity';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { ChatsGateway } from './chats.gateway';
import { UsersModule } from '../users/users.module';
import { FirebaseNotificationService } from './firebase-notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatMessage,
      KostGroupMessage,
      KostGroupSetting,
      Kost,
      User,
    ]),
    UsersModule,
  ],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsGateway, FirebaseNotificationService],
  exports: [ChatsService, ChatsGateway, FirebaseNotificationService],
})
export class ChatsModule {}
