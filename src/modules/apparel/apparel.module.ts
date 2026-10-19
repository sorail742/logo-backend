import { Module } from '@nestjs/common';
import {
  AdminApparelController,
  ApparelController,
  PublicProofController,
} from './apparel.controller';
import { ApparelService } from './apparel.service';

@Module({
  controllers: [ApparelController, PublicProofController, AdminApparelController],
  providers: [ApparelService],
})
export class ApparelModule {}
