import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerPost } from './entities/owner-post.entity';
import { OwnerPostComment } from './entities/owner-post-comment.entity';
import { OwnerPostLike } from './entities/owner-post-like.entity';
import { User } from '../users/entities/user.entity';
import { Kost } from '../kosts/entities/kost.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OwnerPost,
      OwnerPostComment,
      OwnerPostLike,
      User,
      Kost,
    ]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
