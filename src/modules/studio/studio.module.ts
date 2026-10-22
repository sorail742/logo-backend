import { Module } from '@nestjs/common';
import { StudioExportService } from './studio-export.service';
import { StudioImagesService } from './studio-images.service';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, StudioExportService, StudioImagesService],
  exports: [StudioExportService, StudioImagesService],
})
export class StudioModule {}
