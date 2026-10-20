import { Module } from '@nestjs/common';
import { SignaturesModule } from '../signatures/signatures.module';
import { BrandKitFilesService } from './brand-kit-files.service';
import { BrandKitsController, PublicKitController } from './brand-kits.controller';
import { BrandKitsService } from './brand-kits.service';

@Module({
  imports: [SignaturesModule],
  controllers: [BrandKitsController, PublicKitController],
  providers: [BrandKitsService, BrandKitFilesService],
  exports: [BrandKitsService, BrandKitFilesService],
})
export class BrandKitsModule {}
