import { Module } from '@nestjs/common';
import { StudioCutoutService } from './studio-cutout.service';
import { StudioExportService } from './studio-export.service';
import { StudioImagesService } from './studio-images.service';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, StudioExportService, StudioImagesService, StudioCutoutService],
  exports: [StudioExportService, StudioImagesService, StudioCutoutService],
})
export class StudioModule {}
