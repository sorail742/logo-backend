import { Module } from '@nestjs/common';
import { LogoExportService } from './logo-export.service';
import { LogoGeneratorService } from './logo-generator.service';
import { LogosController } from './logos.controller';
import { LogosService } from './logos.service';

@Module({
  controllers: [LogosController],
  providers: [LogosService, LogoGeneratorService, LogoExportService],
  exports: [LogoGeneratorService, LogoExportService],
})
export class LogosModule {}
