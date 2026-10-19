import { Module } from '@nestjs/common';
import {
  AdminSignaturesController,
  PublicSignaturesController,
  SignaturesController,
} from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  controllers: [SignaturesController, PublicSignaturesController, AdminSignaturesController],
  providers: [SignaturesService],
})
export class SignaturesModule {}
