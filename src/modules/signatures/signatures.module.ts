import { Module } from '@nestjs/common';
import { SignatureBatchService } from './signature-batch.service';
import { SignatureBrandService } from './signature-brand.service';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService, SignatureBrandService, SignatureBatchService],
  exports: [SignatureBatchService],
})
export class SignaturesModule {}
