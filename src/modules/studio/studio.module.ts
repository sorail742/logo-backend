import { Module } from '@nestjs/common';
import { StudioExportService } from './studio-export.service';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, StudioExportService],
  exports: [StudioExportService],
})
export class StudioModule {}
