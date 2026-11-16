import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kost } from './entities/kost.entity';
import { Facility } from './entities/facility.entity';
import { UserFavorite } from './entities/user-favorite.entity';
import { User } from '../users/entities/user.entity';
import { KostsService } from './kosts.service';
import { KostsController } from './kosts.controller';
import { ChatsModule } from '../chats/chats.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Kost, Facility, UserFavorite, User]),
    ChatsModule,
    WalletModule,
  ],
  controllers: [KostsController],
  providers: [KostsService],
  exports: [KostsService],
})
export class KostsModule {}
