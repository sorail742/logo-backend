import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BrandKitsModule } from '../brand-kits/brand-kits.module';
import { NameGeneratorService } from './name-generator.service';
import { NamesController } from './names.controller';
import { NamesService } from './names.service';

@Module({
  imports: [AvailabilityModule, BrandKitsModule],
  controllers: [NamesController],
  providers: [NamesService, NameGeneratorService],
  exports: [NameGeneratorService],
})
export class NamesModule {}
