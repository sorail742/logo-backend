import { Module } from '@nestjs/common';
import { WebsiteRenderService } from './website-render.service';
import { PublicWebsiteController, WebsitesController } from './websites.controller';
import { WebsitesService } from './websites.service';

@Module({
  controllers: [WebsitesController, PublicWebsiteController],
  providers: [WebsitesService, WebsiteRenderService],
})
export class WebsitesModule {}
