import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { RdapClient } from './rdap.client';

@Module({
  providers: [AvailabilityService, RdapClient],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
