import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kost } from './entities/kost.entity';
import { Facility } from './entities/facility.entity';
import { User } from '../users/entities/user.entity';
import { KostsService } from './kosts.service';
import { KostsController } from './kosts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Kost, Facility, User])],
  controllers: [KostsController],
  providers: [KostsService],
  exports: [KostsService],
})
export class KostsModule {}
