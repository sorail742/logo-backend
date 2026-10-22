import { Module } from '@nestjs/common';
import { SloganGeneratorService } from './slogan-generator.service';
import { SlogansController } from './slogans.controller';
import { SlogansService } from './slogans.service';

@Module({
  controllers: [SlogansController],
  providers: [SlogansService, SloganGeneratorService],
  exports: [SloganGeneratorService],
})
export class SlogansModule {}
