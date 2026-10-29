import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import {
  ClientIp,
  CurrentUser,
  CurrentWorkspace,
  Public,
  Roles,
  WorkspaceAccess,
} from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import {
  AdminRulePresetDto,
  AdminTemplateDto,
  ApproveProofDto,
  CheckDesignDto,
  CreateApparelDesignDto,
  PrintShopDto,
  ProductionExportDto,
  ProofDto,
  RosterImportDto,
  SaveElementsDto,
  SaveRosterDto,
  UpdateApparelDesignDto,
} from './apparel.dto';
import { projectEvent } from '../projects/project-activity';
import { ApparelService } from './apparel.service';
import { ProductionService } from './production.service';

/** Module 5 — décoration textile (§16.11). */
@ApiTags('apparel')
@ApiBearerAuth()
@Controller()
export class ApparelController {
  constructor(
    private readonly apparel: ApparelService,
    private readonly production: ProductionService,
    private readonly audit: AuditService,
  ) {}

  @Get('apparel/templates')
  templates() {
    return this.apparel.templates();
  }

  @Get('apparel/templates/:tid')
  template(@Param('tid', ParseUUIDPipe) tid: string) {
    return this.apparel.template(tid);
  }

  @Get('apparel/rule-presets')
  rulePresets() {
    return this.apparel.rulePresets();
  }

  @Post('projects/:pid/apparel-designs')
  @WorkspaceAccess('EDITOR')
  create(@Param('pid', ParseUUIDPipe) pid: string, @Body() dto: CreateApparelDesignDto) {
    return this.apparel.createDesign(pid, dto);
  }

  @Get('projects/:pid/apparel-designs')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.apparel.listDesigns(pid);
  }

  @Get('apparel-designs/:did')
  @WorkspaceAccess('VIEWER')
  get(@Param('did', ParseUUIDPipe) did: string) {
    return this.apparel.getDesign(did);
  }

  @Patch('apparel-designs/:did')
  @WorkspaceAccess('EDITOR')
  update(@Param('did', ParseUUIDPipe) did: string, @Body() dto: UpdateApparelDesignDto) {
    return this.apparel.updateDesign(did, dto);
  }

  @Post('apparel-designs/:did/duplicate')
  @WorkspaceAccess('EDITOR')
  duplicate(@Param('did', ParseUUIDPipe) did: string) {
    return this.apparel.duplicateDesign(did);
  }

  @Delete('apparel-designs/:did')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('did', ParseUUIDPipe) did: string) {
    return this.apparel.deleteDesign(did);
  }

  @Put('apparel-designs/:did/elements')
  @WorkspaceAccess('EDITOR')
  saveElements(@Param('did', ParseUUIDPipe) did: string, @Body() dto: SaveElementsDto) {
    return this.apparel.saveElements(did, dto.elements);
  }

  @Post('apparel-designs/:did/check')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  check(
    @Param('did', ParseUUIDPipe) did: string,
    @Body() dto: CheckDesignDto,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.apparel.check(did, { workspaceId: ws.workspaceId, printShopId: dto.printShopId });
  }

  @Post('apparel-designs/:did/roster/import')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  importRoster(@Param('did', ParseUUIDPipe) did: string, @Body() dto: RosterImportDto) {
    return this.apparel.importRoster(did, dto.csv, dto.name);
  }

  @Get('apparel-designs/:did/roster')
  @WorkspaceAccess('VIEWER')
  roster(@Param('did', ParseUUIDPipe) did: string) {
    return this.apparel.getRoster(did);
  }

  @Put('apparel-designs/:did/roster')
  @WorkspaceAccess('EDITOR')
  saveRoster(@Param('did', ParseUUIDPipe) did: string, @Body() dto: SaveRosterDto) {
    return this.apparel.saveRoster(did, dto.name, dto.entries);
  }

  @Post('apparel-designs/:did/proof')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  proof(@Param('did', ParseUUIDPipe) did: string, @Body() dto: ProofDto) {
    return this.apparel.proof(did, dto.revoke ?? false);
  }

  /** Pack atelier : fichiers du support d'impression, un fichier par joueur, fiche technique (202 + jobId). */
  @Post('apparel-designs/:did/production-export')
  @WorkspaceAccess('EDITOR', { download: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  async productionExport(
    @Param('did', ParseUUIDPipe) did: string,
    @Body() dto: ProductionExportDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.production.request(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      did,
      dto,
      idempotencyKey ?? randomUUID(),
    );
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'apparel.production_export', {
        support: dto.support ?? null,
        jobId: job.jobId,
      }),
    );
    return job;
  }

  @Get('workspaces/:wid/print-shops')
  @WorkspaceAccess('OWNER')
  printShops(@Param('wid', ParseUUIDPipe) wid: string) {
    return this.apparel.printShops(wid);
  }

  @Post('workspaces/:wid/print-shops')
  @WorkspaceAccess('OWNER')
  createPrintShop(@Param('wid', ParseUUIDPipe) wid: string, @Body() dto: PrintShopDto) {
    return this.apparel.createPrintShop(wid, dto);
  }

  @Patch('workspaces/:wid/print-shops/:id')
  @WorkspaceAccess('OWNER')
  updatePrintShop(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintShopDto,
  ) {
    return this.apparel.updatePrintShop(wid, id, dto);
  }
}

/** BAT consulté et approuvé par le client, sans compte (TEX-37). */
@ApiTags('apparel')
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('public/proofs')
export class PublicProofController {
  constructor(private readonly apparel: ApparelService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.apparel.publicProof(token);
  }

  @Post(':token/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('token') token: string, @Body() dto: ApproveProofDto, @ClientIp() ip: string) {
    return this.apparel.approveProof(token, dto.approverName, ip);
  }
}

/** Supports, zones, tailles et préréglages (TEX-04, TEX-12). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/apparel')
export class AdminApparelController {
  constructor(
    private readonly apparel: ApparelService,
    private readonly audit: AuditService,
  ) {}

  @Post('templates')
  async createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: AdminTemplateDto,
    @ClientIp() ip: string,
  ) {
    const t = await this.apparel.createTemplate(dto);
    await this.audit.log({
      actorId: user.id,
      action: 'apparel.template.create',
      entityType: 'ProductTemplate',
      entityId: t.id,
      after: dto,
      ip,
    });
    return t;
  }

  @Put('templates/:tid')
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('tid', ParseUUIDPipe) tid: string,
    @Body() dto: AdminTemplateDto,
    @ClientIp() ip: string,
  ) {
    const before = await this.apparel.template(tid);
    const t = await this.apparel.updateTemplate(tid, dto);
    await this.audit.log({
      actorId: user.id,
      action: 'apparel.template.update',
      entityType: 'ProductTemplate',
      entityId: tid,
      before,
      after: dto,
      ip,
    });
    return t;
  }

  @Put('rule-presets')
  async upsertPreset(
    @CurrentUser() user: AuthUser,
    @Body() dto: AdminRulePresetDto,
    @ClientIp() ip: string,
  ) {
    const p = await this.apparel.upsertRulePreset(dto);
    await this.audit.log({
      actorId: user.id,
      action: 'apparel.preset.upsert',
      entityType: 'RulePreset',
      entityId: p.id,
      after: dto,
      ip,
    });
    return p;
  }
}
