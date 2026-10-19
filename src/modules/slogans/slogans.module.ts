import { Module } from '@nestjs/common';
import { LogosModule } from '../logos/logos.module';
import { SloganGeneratorService } from './slogan-generator.service';
import { SlogansController } from './slogans.controller';
import { SlogansService } from './slogans.service';

@Module({
  imports: [LogosModule],
  controllers: [SlogansController],
  providers: [SlogansService, SloganGeneratorService],
  exports: [SloganGeneratorService],
})
export class SlogansModule {}
