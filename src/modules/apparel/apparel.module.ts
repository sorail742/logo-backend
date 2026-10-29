import { Module } from '@nestjs/common';
import {
  AdminApparelController,
  ApparelController,
  PublicProofController,
} from './apparel.controller';
import { ApparelService } from './apparel.service';
import { ProductionService } from './production.service';

@Module({
  controllers: [ApparelController, PublicProofController, AdminApparelController],
  providers: [ApparelService, ProductionService],
  exports: [ProductionService],
})
export class ApparelModule {}
