import { Injectable, Logger } from '@nestjs/common';
import {
  AssetKind,
  EntityType,
  Prisma,
  SignatureKind,
  SignatureStatus,
  type BrandKit,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import { renderBrandGuidePdf, type BrandGuideSignatures } from '../../render/brand-guide';
import type { KitContent, KitFont, KitPaletteColor } from '../../render/brand-kit';
import {
  renderEmailSignature,
  renderEmailSignatureText,
  type EmailSignatureData,
} from '../../render/email-signature';
import { buildKitArchive, type KitArchiveSignatures } from '../../render/kit-archive';
import type { LogoSource } from '../../render/logo-assets';
import {
  businessCardPdf,
  letterheadPdf,
  letterheadWordDocx,
  memberCardPdf,
  type ContactDetails,
  type SupportsInput,
} from '../../render/print-supports';
import type { HandwrittenData } from '../../render/stamp';
import { createZip } from '../../render/zip';
import { EXPORT_RETENTION_DAYS } from '../logos/logo-export.service';
import { logoSource, parseSpec } from '../logos/logo-source';
import { TYPED_NAME_MEANING } from '../projects/projects.service';
import { emailTemplateKey } from '../signatures/signature-data';
import { SignatureBrandService } from '../signatures/signature-brand.service';
import { parseKitContent } from './brand-kit.presenter';
import { BrandKitsService, type KitJobInput } from './brand-kits.service';

/** Résultat enregistré dans GenerationJob.result (lien signé exposé par GET /jobs/:jid). */
export interface KitFileResult {
  assetId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  files?: number;
  restricted?: boolean;
  expiresAt: string;
}

interface KitAssets {
  kit: BrandKit;
  workspaceId: string;
  slug: string;
  content: KitContent;
  logo: LogoSource;
  palette: KitPaletteColor[];
  fonts: KitFont[];
  supports: SupportsInput;
  guide: BrandGuideSignatures;
  archive: KitArchiveSignatures;
}

/** Charte PDF et archive ZIP d'une version du kit, produites par le worker (§7.4). */
@Injectable()
export class BrandKitFilesService {
  private readonly logger = new Logger(BrandKitFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly brands: SignatureBrandService,
    private readonly kits: BrandKitsService,
  ) {}

  async runGuide(jobId: string): Promise<KitFileResult> {
    const { input } = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const assets = await this.assets((input as unknown as KitJobInput).kitId);
    const pdf = await this.guide(assets);
    const fileName = `charte-${assets.slug}-v${assets.kit.version}.pdf`;
    const result = await this.store(jobId, assets, fileName, pdf, 'application/pdf');
    await this.prisma.brandKit.update({
      where: { id: assets.kit.id },
      data: { guidePdfKey: result.storageKey },
    });
    return result;
  }

  async runZip(jobId: string): Promise<KitFileResult> {
    const { input } = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const { kitId, watermark = null } = input as unknown as KitJobInput;
    const assets = await this.assets(kitId);
    const restricted = watermark !== null;

    let charterPdf: Buffer | null = null;
    if (!restricted && (await this.kits.paidGuides(assets.kit.projectId)).has(kitId)) {
      charterPdf = assets.kit.guidePdfKey
        ? await this.storage.get(assets.kit.guidePdfKey).catch(() => null)
        : null;
      charterPdf ??= await this.guide(assets);
    }
    const supports = restricted ? null : await this.supports(assets);
    const entries = await buildKitArchive({
      slug: assets.slug,
      version: assets.kit.version,
      content: assets.content,
      logo: assets.logo,
      watermark,
      charterPdf,
      signatures: assets.archive,
      supports,
    });
    const zip = createZip(entries);
    const fileName = `${assets.slug}-kit-v${assets.kit.version}.zip`;
    const result = await this.store(jobId, assets, fileName, zip, 'application/zip', {
      files: entries.length,
      restricted,
    });
    await this.prisma.brandKit.update({
      where: { id: kitId },
      data: { zipKey: result.storageKey },
    });
    return result;
  }

  private guide(assets: KitAssets) {
    return renderBrandGuidePdf({
      content: assets.content,
      version: assets.kit.version,
      date: assets.kit.createdAt,
      logo: assets.logo,
      palette: assets.palette,
      fonts: assets.fonts,
      signatures: assets.guide,
    });
  }

  /** Supports imprimables (KIT-04) ; la carte de membre est réservée aux associations. */
  private async supports(assets: KitAssets) {
    const [businessCard, letterhead, memberCard] = await Promise.all([
      businessCardPdf(assets.supports),
      letterheadPdf(assets.supports),
      assets.content.entityType === EntityType.ASSOCIATION
        ? memberCardPdf(assets.supports)
        : Promise.resolve(undefined),
    ]);
    return {
      businessCard,
      letterheadPdf: letterhead,
      letterheadDocx: letterheadWordDocx(assets.supports),
      memberCard,
    };
  }

  private async store(
    jobId: string,
    assets: KitAssets,
    fileName: string,
    data: Buffer,
    mimeType: string,
    extra: Pick<KitFileResult, 'files' | 'restricted'> = {},
  ): Promise<KitFileResult> {
    const storageKey = `kits/${assets.workspaceId}/${assets.kit.id}/${jobId}/${fileName}`;
    await this.storage.put(storageKey, data, mimeType);
    const asset = await this.prisma.asset.create({
      data: {
        kind: AssetKind.EXPORT,
        name: fileName,
        storageKey,
        mimeType,
        sizeBytes: data.length,
        tags: [`kit:${assets.kit.id}`, `job:${jobId}`],
      },
    });
    const result: KitFileResult = {
      assetId: asset.id,
      storageKey,
      fileName,
      sizeBytes: data.length,
      ...extra,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
    };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { result: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  }

  /** Tout ce que la charte, l'archive et les supports reprennent d'une version du kit. */
  private async assets(kitId: string): Promise<KitAssets> {
    const kit = await this.prisma.brandKit.findUniqueOrThrow({
      where: { id: kitId },
      include: {
        project: {
          select: {
            id: true,
            workspaceId: true,
            title: true,
            entityType: true,
            chosenName: { select: { value: true, acronym: true, meaning: true } },
          },
        },
      },
    });
    const { project } = kit;
    const stored = parseKitContent(kit.content);
    const content: KitContent = {
      name: stored.name ?? project.chosenName?.value ?? project.title,
      acronym: stored.acronym ?? project.chosenName?.acronym ?? null,
      meaning:
        stored.meaning ??
        (project.chosenName?.meaning !== TYPED_NAME_MEANING ? project.chosenName?.meaning : null) ??
        null,
      entityType: stored.entityType ?? project.entityType,
      slogan: stored.slogan ?? null,
      devise: stored.devise ?? null,
      mission: stored.mission ?? null,
    };

    const version = kit.logoVersionId
      ? await this.prisma.logoVersion.findUnique({
          where: { id: kit.logoVersionId },
          include: { logo: { select: { engine: true } } },
        })
      : null;
    if (!version) throw new Error(`Logo du kit ${kitId} introuvable`);
    const logo = logoSource(version.logo, version);
    const { colors } = parseSpec(version.spec);

    const signatures = await this.signatures(project.id);
    return {
      kit,
      workspaceId: project.workspaceId,
      slug: slugify(content.name) || 'marque',
      content,
      logo,
      palette: kit.palette as unknown as KitPaletteColor[],
      fonts: kit.fonts as unknown as KitFont[],
      supports: { content, logo, colors, contact: signatures.contact },
      guide: {
        stampSvg: signatures.stampSvg,
        handwrittenSvg: signatures.handwritten?.svg ?? null,
        email: signatures.email && {
          template: signatures.email.templateName,
          text: signatures.email.text,
        },
      },
      archive: {
        email: signatures.email,
        stampSvg: signatures.stampSvg,
        handwritten: signatures.handwritten,
      },
    };
  }

  /**
   * Signatures actuelles du projet : la plus récente de chaque type. Le cachet et le paraphe
   * sont repris tels qu'enregistrés (fichier validé), jamais s'ils attendent une validation.
   */
  private async signatures(projectId: string) {
    const rows = await this.prisma.signature.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { key: true, name: true } } },
    });
    const email = rows.find((s) => s.kind === SignatureKind.EMAIL);
    const active = (kind: SignatureKind) =>
      rows.find((s) => s.kind === kind && s.status === SignatureStatus.ACTIVE && s.fileKey);
    const file = async (key: string | null | undefined) =>
      key
        ? ((await this.storage.get(key).catch((err: Error) => {
            this.logger.warn(`Fichier de signature illisible (${key}) : ${err.message}`);
            return null;
          })) ?? null)
        : null;

    const stamp = active(SignatureKind.STAMP);
    const handwritten = active(SignatureKind.HANDWRITTEN);
    const [stampFile, handwrittenFile] = await Promise.all([
      file(stamp?.fileKey),
      file(handwritten?.fileKey),
    ]);

    let emailOut: (KitArchiveSignatures['email'] & { templateName: string }) | null = null;
    let contact: ContactDetails | null = null;
    if (email) {
      const data = email.data as unknown as EmailSignatureData;
      const brand = await this.brands.brand(projectId, email.id);
      emailOut = {
        html: renderEmailSignature(emailTemplateKey(email.template?.key), data, brand),
        text: renderEmailSignatureText(data, brand),
        templateName: email.template?.name ?? 'Classique',
      };
      contact = {
        fullName: data.fullName,
        jobTitle: data.jobTitle,
        phone: data.phones?.[0],
        email: data.email,
        website: data.website,
        address: data.address,
      };
    }
    const handwrittenData = handwritten?.data as unknown as HandwrittenData | undefined;
    return {
      email: emailOut,
      contact,
      stampSvg: stampFile?.toString('utf8') ?? null,
      handwritten: handwrittenFile
        ? {
            svg: handwrittenFile.toString('utf8'),
            fontId: handwrittenData?.strokes ? null : (handwrittenData?.fontId ?? null),
          }
        : null,
    };
  }
}
