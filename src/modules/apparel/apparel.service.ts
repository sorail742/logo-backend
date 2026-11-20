import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApparelDesignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { REFERENCE_SIZE, RULES_DISCLAIMER } from './apparel-defaults';
import {
  checkDesign,
  checkRoster,
  Element,
  ElementContent,
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
  RosterEntryDto,
  UpdateApparelDesignDto,
} from './apparel.dto';

const DESIGN_INCLUDE = {
  template: true,
  rulePreset: true,
  elements: { orderBy: { zIndex: 'asc' } },
  roster: { include: { entries: { orderBy: { number: 'asc' } } } },
} satisfies Prisma.ApparelDesignInclude;

@Injectable()
export class ApparelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ─── Gabarits et préréglages ───

  templates() {
    return this.prisma.apparelTemplate.findMany({
      orderBy: { name: 'asc' },
    });
  }

  template(id: string) {
    return this.prisma.apparelTemplate.findUniqueOrThrow({
      where: { id },
    });
  }

  async rulePresets() {
    const presets = await this.prisma.rulePreset.findMany({ orderBy: { name: 'asc' } });
    return { disclaimer: RULES_DISCLAIMER, presets };
  }

  // ─── Tenues ───

  async createDesign(projectId: string, dto: CreateApparelDesignDto) {
    await this.prisma.apparelTemplate.findUniqueOrThrow({
      where: { id: dto.templateId },
    });
    if (dto.rulePresetId) {
      await this.prisma.rulePreset.findUniqueOrThrow({ where: { id: dto.rulePresetId } });
    }
    return this.prisma.apparelDesign.create({
      data: {
        projectId,
        templateId: dto.templateId,
        rulePresetId: dto.rulePresetId,
        name: dto.name,
        technique: dto.technique,
        garmentColor: dto.garmentColor,
        status: ApparelDesignStatus.DRAFT,
      },
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

  /**
   * Modification d'une tenue.
   * RÈGLE CRUCIALE : si proofToken existait, le révoquer et repasser la tenue au statut DRAFT
   * (toute modification invalide un BAT déjà envoyé).
   */
  async updateDesign(id: string, dto: UpdateApparelDesignDto) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({ where: { id } });
    if (dto.rulePresetId) {
      await this.prisma.rulePreset.findUniqueOrThrow({ where: { id: dto.rulePresetId } });
    }
    const revokeData: Prisma.ApparelDesignUpdateInput = design.proofToken
      ? {
          proofToken: null,
          status: ApparelDesignStatus.DRAFT,
          approvedAt: null,
          approverName: null,
        }
      : {};

    const { rulePresetId, ...restDto } = dto;
    const rulePresetUpdate: Prisma.ApparelDesignUpdateInput =
      rulePresetId === null
        ? { rulePreset: { disconnect: true } }
        : rulePresetId !== undefined
          ? { rulePreset: { connect: { id: rulePresetId } } }
          : {};

    return this.prisma.apparelDesign.update({
      where: { id },
      data: {
        ...restDto,
        ...rulePresetUpdate,
        ...revokeData,
      },
      include: DESIGN_INCLUDE,
    });
  }

  /**
   * Duplication complète de la tenue avec éléments et effectif.
   */
  async duplicateDesign(id: string) {
    const source = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id },
      include: { elements: true, roster: { include: { entries: true } } },
    });
    const { roster } = source;
    return this.prisma.apparelDesign.create({
      data: {
        projectId: source.projectId,
        templateId: source.templateId,
        rulePresetId: source.rulePresetId,
        name: `${source.name} (copie)`.slice(0, 120),
        technique: source.technique,
        garmentColor: source.garmentColor,
        status: ApparelDesignStatus.DRAFT,
        elements: {
          create: source.elements.map((el) => ({
            zoneKey: el.zoneKey,
            kind: el.kind,
            content: el.content as Prisma.InputJsonValue,
            widthMm: el.widthMm,
            heightMm: el.heightMm,
            offsetXMm: el.offsetXMm,
            offsetYMm: el.offsetYMm,
            rotationDeg: el.rotationDeg,
            zIndex: el.zIndex,
          })),
        },
        roster: roster
          ? {
              create: {
                name: roster.name,
                entries: {
                  create: roster.entries.map((e) => ({
                    playerName: e.playerName,
                    displayName: e.displayName,
                    number: e.number,
                    size: e.size,
                    quantity: e.quantity,
                    role: e.role,
                  })),
                },
              },
            }
          : undefined,
      },
      include: DESIGN_INCLUDE,
    });
  }

  async deleteDesign(id: string) {
    await this.prisma.apparelDesign.delete({ where: { id } });
  }

  /**
   * Remplacement atomique de tous les éléments d'une tenue (sauvegarde auto du Studio).
   * Valider que chaque zoneKey appartient au template.
   */
  async saveElements(id: string, elements: DesignElementDto[]) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id },
      include: { template: true },
    });
    const templateZones = (design.template.zones as unknown as Zone[]) || [];
    const validZoneKeys = new Set(templateZones.map((z) => z.key));
    const unknown = elements.filter((e) => !validZoneKeys.has(e.zoneKey)).map((e) => e.zoneKey);
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Zones absentes de ce gabarit : ${[...new Set(unknown)].join(', ')}`,
      );
    }

    const revokeData: Prisma.ApparelDesignUpdateInput = design.proofToken
      ? {
          proofToken: null,
          status: ApparelDesignStatus.DRAFT,
          approvedAt: null,
          approverName: null,
        }
      : {};

    await this.prisma.$transaction([
      this.prisma.apparelElement.deleteMany({ where: { designId: id } }),
      this.prisma.apparelElement.createMany({
        data: elements.map((e, i) => ({
          designId: id,
          zoneKey: e.zoneKey,
          kind: e.kind,
          content: e.content as Prisma.InputJsonValue,
          widthMm: e.widthMm,
          heightMm: e.heightMm,
          offsetXMm: e.offsetXMm ?? 0,
          offsetYMm: e.offsetYMm ?? 0,
          rotationDeg: e.rotationDeg ?? 0,
          zIndex: e.zIndex ?? i,
        })),
      }),
      this.prisma.apparelDesign.update({ where: { id }, data: revokeData }),
    ]);
    return this.getDesign(id);
  }

  // ─── Contrôle de conformité (POST /apparel-designs/:did/check) ───

  async check(id: string) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id },
      include: {
        template: true,
        rulePreset: true,
        elements: true,
        roster: { include: { entries: true } },
      },
    });

    const preset = (design.rulePreset?.rules ?? null) as PresetRules | null;
    const zones = (design.template.zones as unknown as Zone[]) || [];
    const elements: Element[] = design.elements.map((e) => ({
      id: e.id,
      zoneKey: e.zoneKey,
      kind: e.kind,
      widthMm: e.widthMm,
      heightMm: e.heightMm,
      offsetXMm: e.offsetXMm,
      offsetYMm: e.offsetYMm,
      content: (e.content ?? {}) as ElementContent,
    }));

    const issues: Issue[] = checkDesign({
      zones,
      elements,
      technique: design.technique,
      garmentColor: design.garmentColor,
      preset,
    });

    if (design.roster) {
      const templateSizes = (design.template.sizes as unknown as Array<{ label: string }>) || [];
      const sizeLabels = templateSizes.map((s) => s.label);
      const entries = design.roster.entries;
      issues.push(...checkRoster(entries, sizeLabels, preset));
      issues.push(...this.checkNames(entries, zones, elements, preset));
    }

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      disclaimer: design.rulePreset ? RULES_DISCLAIMER : undefined,
      referenceSize: REFERENCE_SIZE,
    };
  }

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

  // ─── Effectif (TeamRoster) ───

  getRoster(designId: string) {
    return this.prisma.teamRoster.findUnique({
      where: { designId },
      include: { entries: { orderBy: { number: 'asc' } } },
    });
  }

  async importRoster(designId: string, csv: string, name?: string) {
    const { rows, errors } = parseRosterCsv(csv);
    if (errors.length) {
      throw new UnprocessableEntityException({ message: 'Fichier d’effectif invalide', errors });
    }
    return this.saveRoster(designId, name ?? 'Effectif', rows);
  }

  async saveRoster(designId: string, name: string, rows: (RosterRow | RosterEntryDto)[]) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id: designId },
      include: { template: true, rulePreset: true },
    });
    const normalized: RosterRow[] = rows.map((r) => ({
      playerName: r.playerName.trim(),
      displayName: r.displayName.trim(),
      number: r.number?.trim() || null,
      size: r.size.trim().toUpperCase(),
      quantity: r.quantity ?? 1,
      role: r.role?.trim() || null,
    }));

    const templateSizes = (design.template.sizes as unknown as Array<{ label: string }>) || [];
    const sizeLabels = templateSizes.map((s) => s.label);
    const issues = checkRoster(
      normalized,
      sizeLabels,
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
        data: normalized.map((r) => ({
          rosterId: roster.id,
          playerName: r.playerName,
          displayName: r.displayName,
          number: r.number,
          size: r.size,
          quantity: r.quantity ?? 1,
          role: r.role,
        })),
      });
    });

    const roster = await this.getRoster(designId);
    return { roster, summary: sizeSummary(normalized) };
  }

  // ─── BAT (Bon à tirer public) ───

  /**
   * POST /apparel-designs/:did/proof : Génère le token public de BAT (32 caractères hex)
   * et passe à PROOF_SENT. Rejette avec code HTTP 422 si l'audit check a des erreurs bloquantes.
   * Si { revoke: true }, annule le token.
   */
  async proof(designId: string, revoke = false) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({ where: { id: designId } });
    if (revoke) {
      await this.prisma.apparelDesign.update({
        where: { id: designId },
        data: {
          proofToken: null,
          status: design.status === 'PROOF_SENT' ? ApparelDesignStatus.DRAFT : design.status,
        },
      });
      return { revoked: true };
    }
    if (
      design.status === ApparelDesignStatus.APPROVED ||
      design.status === ApparelDesignStatus.IN_PRODUCTION
    ) {
      throw new ConflictException('Cette tenue est déjà approuvée');
    }
    const report = await this.check(designId);
    if (!report.ok) {
      throw new UnprocessableEntityException({
        message: 'Corrigez les erreurs bloquantes avant d’envoyer le BAT',
        issues: report.errors,
      });
    }

    // Token aléatoire de 32 caractères hexadécimaux
    const token = design.proofToken ?? randomBytes(16).toString('hex');
    await this.prisma.apparelDesign.update({
      where: { id: designId },
      data: { proofToken: token, status: ApparelDesignStatus.PROOF_SENT },
    });
    return {
      token,
      url: `${this.config.getOrThrow<string>('APP_URL')}/bat/${token}`,
    };
  }

  /**
   * GET /public/proofs/:token : Route publique (sans auth) pour consultation du BAT
   * avec rendu des faces et tableau d'effectif.
   */
  async publicProof(token: string) {
    const design = await this.prisma.apparelDesign.findUnique({
      where: { proofToken: token },
      include: {
        template: true,
        elements: { orderBy: { zIndex: 'asc' } },
        roster: {
          include: {
            entries: { orderBy: { number: 'asc' } },
          },
        },
      },
    });
    if (!design) throw new NotFoundException('BAT introuvable ou révoqué');
    return design;
  }

  /**
   * POST /public/proofs/:token/approve : Route publique (sans auth) :
   * Validation et signature par le client (approverName). Statut -> APPROVED, horodatage approvedAt.
   */
  async approveProof(token: string, approverName: string, ip: string) {
    const design = await this.prisma.apparelDesign.findUnique({ where: { proofToken: token } });
    if (!design) throw new NotFoundException('BAT introuvable ou révoqué');
    if (design.status === ApparelDesignStatus.APPROVED) {
      return {
        status: design.status,
        approvedAt: design.approvedAt,
        approverName: design.approverName,
      };
    }
    if (design.status !== ApparelDesignStatus.PROOF_SENT) {
      throw new GoneException('Ce BAT n’est plus en attente d’approbation');
    }

    const approvedAt = new Date();
    const updated = await this.prisma.apparelDesign.updateMany({
      where: { id: design.id, status: ApparelDesignStatus.PROOF_SENT, proofToken: token },
      data: {
        status: ApparelDesignStatus.APPROVED,
        approvedAt,
        approverName,
      },
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
    return { status: ApparelDesignStatus.APPROVED, approvedAt, approverName };
  }

  // ─── Administration (Gabarits & Préréglages) ───

  createTemplate(dto: AdminTemplateDto) {
    return this.prisma.apparelTemplate.create({
      data: {
        category: dto.category,
        name: dto.name,
        description: dto.description,
        material: dto.material,
        sizes: dto.sizes as unknown as Prisma.InputJsonValue,
        zones: dto.zones as unknown as Prisma.InputJsonValue,
      },
    });
  }

  updateTemplate(id: string, dto: AdminTemplateDto) {
    return this.prisma.apparelTemplate.update({
      where: { id },
      data: {
        category: dto.category,
        name: dto.name,
        description: dto.description,
        material: dto.material,
        sizes: dto.sizes as unknown as Prisma.InputJsonValue,
        zones: dto.zones as unknown as Prisma.InputJsonValue,
      },
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
