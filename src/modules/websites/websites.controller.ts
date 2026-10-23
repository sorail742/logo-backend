import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, Public, WorkspaceAccess } from '../../common/decorators';
import { FONTS_DIR } from '../../render/fonts';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import { siteFontFile, type FontSubset } from './website-render.service';
import {
  AddWebsiteMediaDto,
  MarkMessageDto,
  SiteMessageDto,
  UpdateWebsiteDto,
} from './websites.dto';
import { WebsitesService } from './websites.service';

/** Site web de la marque : édition (Éditeur), publication, médias, messages reçus. */
@ApiTags('websites')
@ApiBearerAuth()
@Controller()
export class WebsitesController {
  constructor(
    private readonly websites: WebsitesService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:pid/website')
  @WorkspaceAccess('VIEWER')
  get(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.websites.get(pid);
  }

  @Post('projects/:pid/website')
  @WorkspaceAccess('EDITOR')
  async create(@Param('pid', ParseUUIDPipe) pid: string, @CurrentUser() user: AuthUser) {
    const site = await this.websites.create(pid);
    await this.audit.log(projectEvent(pid, user.id, 'site.create', { slug: site.slug }));
    return site;
  }

  @Patch('websites/:webid')
  @WorkspaceAccess('EDITOR')
  update(@Param('webid', ParseUUIDPipe) webid: string, @Body() dto: UpdateWebsiteDto) {
    return this.websites.update(webid, dto);
  }

  @Post('websites/:webid/publish')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param('webid', ParseUUIDPipe) webid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const site = await this.websites.publish(webid);
    await this.audit.log(projectEvent(ws.projectId!, user.id, 'site.publish', { slug: site.slug }));
    return site;
  }

  @Post('websites/:webid/unpublish')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @Param('webid', ParseUUIDPipe) webid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const site = await this.websites.unpublish(webid);
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'site.unpublish', { slug: site.slug }),
    );
    return site;
  }

  @Delete('websites/:webid')
  @WorkspaceAccess('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('webid', ParseUUIDPipe) webid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const { slug } = await this.websites.remove(webid);
    await this.audit.log(projectEvent(ws.projectId!, user.id, 'site.delete', { slug }));
  }

  @Get('websites/:webid/brand')
  @WorkspaceAccess('VIEWER')
  brand(@Param('webid', ParseUUIDPipe) webid: string) {
    return this.websites.brand(webid);
  }

  @Post('websites/:webid/media')
  @WorkspaceAccess('EDITOR')
  addMedia(@Param('webid', ParseUUIDPipe) webid: string, @Body() dto: AddWebsiteMediaDto) {
    return this.websites.addMedia(webid, dto);
  }

  @Delete('websites/:webid/media/:mid')
  @WorkspaceAccess('EDITOR')
  removeMedia(
    @Param('webid', ParseUUIDPipe) webid: string,
    @Param('mid', ParseUUIDPipe) mid: string,
  ) {
    return this.websites.removeMedia(webid, mid);
  }

  @Get('websites/:webid/messages')
  @WorkspaceAccess('EDITOR')
  messages(@Param('webid', ParseUUIDPipe) webid: string) {
    return this.websites.messages(webid);
  }

  @Patch('websites/:webid/messages/:msgid')
  @WorkspaceAccess('EDITOR')
  markMessage(
    @Param('webid', ParseUUIDPipe) webid: string,
    @Param('msgid', ParseUUIDPipe) msgid: string,
    @Body() dto: MarkMessageDto,
  ) {
    return this.websites.markMessage(webid, msgid, dto.read);
  }

  @Delete('websites/:webid/messages/:msgid')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMessage(
    @Param('webid', ParseUUIDPipe) webid: string,
    @Param('msgid', ParseUUIDPipe) msgid: string,
  ) {
    await this.websites.removeMessage(webid, msgid);
  }

  @Post('websites/:webid/export')
  @WorkspaceAccess('EDITOR', { download: true })
  @HttpCode(HttpStatus.OK)
  async export(
    @Param('webid', ParseUUIDPipe) webid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const result = await this.websites.exportZip(webid);
    await this.audit.log(projectEvent(ws.projectId!, user.id, 'site.export'));
    return result;
  }
}

/**
 * Site publié : page, fichiers, images, polices et formulaire de contact, sans authentification.
 * La page est servie par le front sous /site/<adresse> ; un site exporté et hébergé ailleurs
 * envoie toujours ses messages ici (d'où l'origine « * » du formulaire et des polices).
 */
@ApiTags('websites')
@Public()
@Controller('public')
export class PublicWebsiteController {
  constructor(private readonly websites: WebsitesService) {}

  @Get('sites/:slug')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async page(@Param('slug') slug: string, @Res() res: Response) {
    const html = await this.websites.publicHtml(slug.toLowerCase());
    res.setHeader('Cache-Control', 'no-cache');
    res.type('text/html; charset=utf-8').send(html);
  }

  @Get('sites/:siteId/files/:name')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async file(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    const data = await this.websites.publicFile(siteId, name);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type(name.endsWith('.jpg') ? 'image/jpeg' : 'image/png').send(data);
  }

  @Get('site-media/:mid')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async media(@Param('mid', ParseUUIDPipe) mid: string, @Res() res: Response) {
    const { data, mimeType } = await this.websites.publicMedia(mid);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(mimeType).send(data);
  }

  @Get('site-fonts/:font/:weight/:subset')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async font(
    @Param('font') font: string,
    @Param('weight', ParseIntPipe) weight: number,
    @Param('subset') subset: string,
    @Res() res: Response,
  ) {
    const file =
      subset === 'latin' || subset === 'latin-ext'
        ? siteFontFile(font, weight, subset as FontSubset)
        : null;
    if (!file) throw new NotFoundException('Police introuvable');
    const data = await readFile(join(FONTS_DIR, file));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('font/woff').send(data);
  }

  @Post('sites/:siteId/messages')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  message(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Body() dto: SiteMessageDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return this.websites.receiveMessage(siteId, dto);
  }
}
