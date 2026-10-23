import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApparelDesignStatus, PrintTechnique, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken } from '../../common/utils/crypto.util';
import { AuditService } from '../audit/audit.service';
import { parseElementContents } from './apparel-content';
import { REFERENCE_SIZE, RULES_DISCLAIMER } from './apparel-defaults';
import {
  checkDesign,
  checkRoster,
  Element,
  fitText,
  Issue,
  parseRosterCsv,
  PresetRules,
  RosterRow,
  Zone,
} from './apparel-rules';
import {
  AdminRulePresetDto,
  AdminTemplateDto,
  CreateApparelDesignDto,
  DesignElementDto,
  PrintShopDto,
  RosterEntryDto,
  UpdateApparelDesignDto,
} from './apparel.dto';

const DESIGN_INCLUDE = {
  template: { select: { id: true, name: true, category: true } },
  rulePreset: true,
  elements: { orderBy: { zIndex: 'asc' } },
  roster: { include: { entries: { orderBy: { number: 'asc' } } } },
} satisfies Prisma.ApparelDesignInclude;

/** Statuts qui exigent une nouvelle validation après toute modification. */
const LOCKED: ApparelDesignStatus[] = ['PROOF_SENT', 'APPROVED'];

@Injectable()
export class ApparelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ─── Supports et préréglages ───

  templates() {
    return this.prisma.productTemplate.findMany({
      where: { isActive: true },
      include: { sizes: { orderBy: { sortOrder: 'asc' } }, zones: { orderBy: { key: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  template(id: string) {
    return this.prisma.productTemplate.findUniqueOrThrow({
      where: { id },
      include: { sizes: { orderBy: { sortOrder: 'asc' } }, zones: { orderBy: { key: 'asc' } } },
    });
  }

  async rulePresets() {
    const presets = await this.prisma.rulePreset.findMany({ orderBy: { name: 'asc' } });
    return { disclaimer: RULES_DISCLAIMER, presets };
  }

  // ─── Tenues ───

  async createDesign(projectId: string, dto: CreateApparelDesignDto) {
    const template = await this.prisma.productTemplate.findUnique({
      where: { id: dto.templateId },
    });
    if (!template?.isActive) throw new BadRequestException('Support introuvable ou désactivé');
    if (dto.rulePresetId)
      await this.prisma.rulePreset.findUniqueOrThrow({ where: { id: dto.rulePresetId } });
    return this.prisma.apparelDesign.create({
      data: { projectId, ...dto },
      include: DESIGN_INCLUDE,
    });
  }

  listDesigns(projectId: string) {
    return this.prisma.apparelDesign.findMany({
      where: { projectId },
      include: {
        template: { select: { name: true, category: true } },
        _count: { select: { elements: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  getDesign(id: string) {
    return this.prisma.apparelDesign.findUniqueOrThrow({ where: { id }, include: DESIGN_INCLUDE });
  }

  async updateDesign(id: string, dto: UpdateApparelDesignDto) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({ where: { id } });
    if (dto.rulePresetId)
      await this.prisma.rulePreset.findUniqueOrThrow({ where: { id: dto.rulePresetId } });
    return this.prisma.apparelDesign.update({
      where: { id },
      data: { ...dto, ...this.unlock(design.status) },
      include: DESIGN_INCLUDE,
    });
  }

  async deleteDesign(id: string) {
    await this.prisma.apparelDesign.delete({ where: { id } });
  }

  /** Enregistre l'état complet de l'éditeur (remplacement). */
  async saveElements(id: string, elements: DesignElementDto[]) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id },
      include: { template: { include: { zones: { select: { key: true } } } } },
    });
    const keys = new Set(design.template.zones.map((z) => z.key));
    const unknown = elements.filter((e) => !keys.has(e.zoneKey)).map((e) => e.zoneKey);
    if (unknown.length) {
      throw new BadRequestException(
        `Zones absentes de ce support : ${[...new Set(unknown)].join(', ')}`,
      );
    }
    const contents = parseElementContents(elements.map((e) => e.content));

    await this.prisma.$transaction([
      this.prisma.designElement.deleteMany({ where: { designId: id } }),
      this.prisma.designElement.createMany({
        data: elements.map((e, i) => ({
          designId: id,
          zoneKey: e.zoneKey,
          kind: e.kind,
          content: contents[i],
          widthMm: e.widthMm,
          heightMm: e.heightMm,
          offsetXMm: e.offsetXMm,
          offsetYMm: e.offsetYMm,
          rotationDeg: e.rotationDeg ?? 0,
          zIndex: e.zIndex ?? i,
        })),
      }),
      this.prisma.apparelDesign.update({ where: { id }, data: this.unlock(design.status) }),
    ]);
    return this.getDesign(id);
  }

  /** Une tenue modifiée après envoi du BAT doit être revalidée. */
  private unlock(status: ApparelDesignStatus): Prisma.ApparelDesignUncheckedUpdateInput {
    return LOCKED.includes(status)
      ? { status: ApparelDesignStatus.DRAFT, approvedAt: null, proofToken: null }
      : {};
  }

  // ─── Contrôle de conformité (TEX-10, POST /check) ───

  async check(id: string, opts: { workspaceId?: string; printShopId?: string } = {}) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id },
      include: {
        template: { include: { zones: true, sizes: true } },
        rulePreset: true,
        elements: true,
        roster: { include: { entries: true } },
      },
    });

    let minStrokeMm: Partial<Record<PrintTechnique, number>> | undefined;
    if (opts.printShopId) {
      const shop = await this.prisma.printShopProfile.findFirst({
        where: { id: opts.printShopId, ...(opts.workspaceId && { workspaceId: opts.workspaceId }) },
      });
      if (!shop) throw new NotFoundException('Profil atelier introuvable');
      minStrokeMm = (shop.minStrokeMm ?? undefined) as typeof minStrokeMm;
      if (!shop.techniques.includes(design.technique)) {
        throw new BadRequestException('Cet atelier ne propose pas la technique choisie');
      }
    }

    const preset = (design.rulePreset?.rules ?? null) as PresetRules | null;
    const zones: Zone[] = design.template.zones;
    const elements: Element[] = design.elements.map((e) => ({
      ...e,
      content: (e.content ?? {}) as Element['content'],
    }));

    const issues: Issue[] = checkDesign({
      zones,
      elements,
      technique: design.technique,
      garmentColor: design.garmentColor,
      preset,
      minStrokeMm,
    });

    if (design.roster) {
      const entries = design.roster.entries;
      issues.push(
        ...checkRoster(
          entries,
          design.template.sizes.map((s) => s.label),
          preset,
        ),
      );
      issues.push(...this.checkNames(entries, zones, elements, preset));
    }

    const errors = issues.filter((i) => i.severity === 'error');
    return {
      ok: errors.length === 0,
      errors,
      warnings: issues.filter((i) => i.severity === 'warning'),
      disclaimer: design.rulePreset ? RULES_DISCLAIMER : undefined,
      referenceSize: REFERENCE_SIZE,
    };
  }

  /** Le nom le plus long doit tenir dans sa zone sans descendre sous le minimum (TEX-23). */
  private checkNames(
    entries: RosterRow[],
    zones: Zone[],
    elements: Element[],
    preset: PresetRules | null,
  ): Issue[] {
    const nameEl = elements.find((e) => e.kind === 'PLAYER_NAME');
    const zone = nameEl && zones.find((z) => z.key === nameEl.zoneKey);
    if (!nameEl || !zone) return [];
    const minHeight = preset?.names?.height?.min ?? 0;
    return entries.flatMap((e) => {
      const fit = fitText(e.displayName, zone.maxWidthMm, nameEl.heightMm, minHeight);
      if (fit.fits) return [];
      return [
        {
          code: 'NAME_TOO_LONG',
          severity: 'error' as const,
          zoneKey: zone.key,
          message: `« ${e.displayName} » ne tient pas dans ${zone.maxWidthMm} mm sans descendre sous ${minHeight / 10} cm : raccourcissez le nom imprimé`,
        },
      ];
    });
  }

  // ─── Effectif (TEX-40 à TEX-44) ───

  getRoster(designId: string) {
    return this.prisma.teamRoster.findUnique({
      where: { designId },
      include: { entries: { orderBy: { number: 'asc' } } },
    });
  }

  async importRoster(designId: string, csv: string, name?: string) {
    const { rows, errors } = parseRosterCsv(csv);
    if (errors.length)
      throw new UnprocessableEntityException({ message: 'Fichier d’effectif invalide', errors });
    return this.saveRoster(designId, name ?? 'Effectif', rows);
  }

  async saveRoster(designId: string, name: string, rows: (RosterRow | RosterEntryDto)[]) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id: designId },
      include: { template: { include: { sizes: true } }, rulePreset: true },
    });
    const normalized: RosterRow[] = rows.map((r) => ({
      playerName: r.playerName.trim(),
      displayName: r.displayName.trim(),
      number: r.number?.trim() || null,
      size: r.size.trim().toUpperCase(),
      quantity: r.quantity ?? 1,
      role: r.role?.trim() || null,
    }));

    const issues = checkRoster(
      normalized,
      design.template.sizes.map((s) => s.label),
      design.rulePreset?.rules as PresetRules | null,
    );
    if (issues.some((i) => i.severity === 'error')) {
      throw new UnprocessableEntityException({ message: 'Effectif non conforme', issues });
    }

    await this.prisma.$transaction(async (tx) => {
      const roster = await tx.teamRoster.upsert({
        where: { designId },
        create: { designId, name },
        update: { name },
      });
      await tx.rosterEntry.deleteMany({ where: { rosterId: roster.id } });
      await tx.rosterEntry.createMany({
        data: normalized.map((r) => ({ ...r, rosterId: roster.id, quantity: r.quantity ?? 1 })),
      });
    });

    const roster = await this.getRoster(designId);
    return { roster, summary: sizeSummary(normalized) };
  }

  // ─── BAT (TEX-37) ───

  async proof(designId: string, revoke = false) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({ where: { id: designId } });
    if (revoke) {
      await this.prisma.apparelDesign.update({
        where: { id: designId },
        data: { proofToken: null, ...(design.status === 'PROOF_SENT' && { status: 'DRAFT' }) },
      });
      return { revoked: true };
    }
    if (design.status === 'APPROVED' || design.status === 'IN_PRODUCTION') {
      throw new ConflictException('Cette tenue est déjà approuvée');
    }
    const report = await this.check(designId);
    if (!report.ok) {
      throw new UnprocessableEntityException({
        message: 'Corrigez les erreurs avant d’envoyer le BAT',
        issues: report.errors,
      });
    }
    const token = design.proofToken ?? randomToken(24);
    await this.prisma.apparelDesign.update({
      where: { id: designId },
      data: { proofToken: token, status: 'PROOF_SENT' },
    });
    return { token, url: `${this.config.getOrThrow<string>('APP_URL')}/bat/${token}` };
  }

  async publicProof(token: string) {
    const design = await this.prisma.apparelDesign.findUnique({
      where: { proofToken: token },
      select: {
        name: true,
        technique: true,
        garmentColor: true,
        status: true,
        approvedAt: true,
        // Zones : la page du BAT place chaque élément sur le vêtement.
        template: {
          select: {
            name: true,
            category: true,
            views: true,
            zones: { orderBy: { key: 'asc' } },
          },
        },
        elements: { orderBy: { zIndex: 'asc' } },
        roster: {
          select: {
            name: true,
            entries: { select: { displayName: true, number: true, size: true, quantity: true } },
          },
        },
      },
    });
    if (!design) throw new NotFoundException('BAT introuvable ou révoqué');
    return design;
  }

  /** Approbation horodatée et tracée (adresse IP, nom du signataire). */
  async approveProof(token: string, approverName: string, ip: string) {
    const design = await this.prisma.apparelDesign.findUnique({ where: { proofToken: token } });
    if (!design) throw new NotFoundException('BAT introuvable ou révoqué');
    if (design.status === 'APPROVED')
      return { status: design.status, approvedAt: design.approvedAt };
    if (design.status !== 'PROOF_SENT')
      throw new GoneException('Ce BAT n’est plus en attente d’approbation');

    const approvedAt = new Date();
    const updated = await this.prisma.apparelDesign.updateMany({
      where: { id: design.id, status: 'PROOF_SENT', proofToken: token },
      data: { status: 'APPROVED', approvedAt },
    });
    if (updated.count === 0) throw new GoneException('Ce BAT a été modifié entre-temps');

    await this.audit.log({
      actorId: null,
      action: 'apparel.proof.approve',
      entityType: 'ApparelDesign',
      entityId: design.id,
      after: { approverName, approvedAt },
      ip,
    });
    return { status: 'APPROVED', approvedAt };
  }

  // ─── Profils atelier (TEX-05) ───

  printShops(workspaceId: string) {
    return this.prisma.printShopProfile.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
  }

  createPrintShop(workspaceId: string, dto: PrintShopDto) {
    const data = toShopData(dto) as Omit<
      Prisma.PrintShopProfileUncheckedCreateInput,
      'workspaceId'
    >;
    return this.prisma.printShopProfile.create({ data: { ...data, workspaceId } });
  }

  async updatePrintShop(workspaceId: string, id: string, dto: Partial<PrintShopDto>) {
    const shop = await this.prisma.printShopProfile.findFirst({ where: { id, workspaceId } });
    if (!shop) throw new NotFoundException('Profil atelier introuvable');
    return this.prisma.printShopProfile.update({ where: { id }, data: toShopData(dto) });
  }

  // ─── Administration (TEX-04) ───

  async createTemplate(dto: AdminTemplateDto) {
    assertUniqueKeys(dto);
    const { sizes, zones, ...data } = dto;
    return this.prisma.productTemplate.create({
      data: { ...data, sizes: { create: sizes }, zones: { create: zones.map(zoneData) } },
      include: { sizes: true, zones: true },
    });
  }

  /** Remplace intégralement tailles et zones : un nouveau support sans déploiement. */
  async updateTemplate(id: string, dto: AdminTemplateDto) {
    assertUniqueKeys(dto);
    const { sizes, zones, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      await tx.productSize.deleteMany({ where: { templateId: id } });
      await tx.printZone.deleteMany({ where: { templateId: id } });
      return tx.productTemplate.update({
        where: { id },
        data: { ...data, sizes: { create: sizes }, zones: { create: zones.map(zoneData) } },
        include: { sizes: true, zones: true },
      });
    });
  }

  upsertRulePreset(dto: AdminRulePresetDto) {
    const data = { name: dto.name, rules: dto.rules as Prisma.InputJsonValue };
    return this.prisma.rulePreset.upsert({
      where: { code: dto.code },
      create: { code: dto.code, ...data },
      update: data,
    });
  }
}

function sizeSummary(rows: RosterRow[]) {
  const bySize: Record<string, number> = {};
  for (const r of rows) bySize[r.size] = (bySize[r.size] ?? 0) + (r.quantity ?? 1);
  return {
    players: rows.length,
    garments: Object.values(bySize).reduce((a, b) => a + b, 0),
    bySize,
  };
}

function toShopData(dto: Partial<PrintShopDto>) {
  return {
    ...dto,
    minStrokeMm: dto.minStrokeMm as Prisma.InputJsonValue | undefined,
    vinylColors: dto.vinylColors as Prisma.InputJsonValue | undefined,
    garmentSizes: dto.garmentSizes as Prisma.InputJsonValue | undefined,
  } as Prisma.PrintShopProfileUncheckedUpdateInput;
}

function zoneData(z: AdminTemplateDto['zones'][number]) {
  return { ...z, rules: z.rules as Prisma.InputJsonValue | undefined };
}

function assertUniqueKeys(dto: AdminTemplateDto) {
  const dup = (arr: string[]) => arr.find((v, i) => arr.indexOf(v) !== i);
  const zone = dup(dto.zones.map((z) => z.key));
  const size = dup(dto.sizes.map((s) => s.label));
  if (zone || size) throw new BadRequestException(`Doublon : ${zone ?? size}`);
}
