import { Global, Module } from '@nestjs/common';
import { DuitkuService } from './duitku.service';

@Global()
@Module({
  providers: [DuitkuService],
  exports: [DuitkuService],
})
export class PaymentsModule {}
