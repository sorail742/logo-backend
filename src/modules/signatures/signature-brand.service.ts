import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { renderLogoSvg } from '../../render/logo';
import { markSvg, type LogoSource } from '../../render/logo-assets';
import type { SignatureBrand } from '../../render/email-signature';
import { recolorSvg } from '../../render/svg';
import { workspacePlan } from '../billing/plan-features';
import { logoSource } from '../logos/logo-source';

/** Mention imposée par l'offre gratuite sous la signature e-mail (même libellé que le front). */
export const POWERED_BY = 'Signature créée avec Marka';

/**
 * Identité du projet reprise par les signatures (§6) : nom retenu, slogan choisi, logo favori
 * (ou le plus récent) et ses couleurs.
 */
@Injectable()
export class SignatureBrandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Version courante du logo favori, ou du dernier logo, du projet. */
  async logo(projectId: string): Promise<{ versionId: string; source: LogoSource } | null> {
    const logo = await this.prisma.logo.findFirst({
      where: { projectId },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      select: {
        engine: true,
        versions: { orderBy: { number: 'desc' }, take: 1 },
      },
    });
    const version = logo?.versions[0];
    if (!logo || !version) return null;
    return { versionId: version.id, source: logoSource(logo, version) };
  }

  /** Marque d'une signature e-mail ; le logo est servi en PNG par une URL publique stable. */
  async brand(projectId: string, signatureId: string | null): Promise<SignatureBrand> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { title: true, workspaceId: true, chosenName: { select: { value: true } } },
    });
    const [slogan, logo, plan] = await Promise.all([
      this.prisma.slogan.findFirst({
        where: { projectId, kind: 'SLOGAN', isChosen: true },
        select: { text: true },
      }),
      this.logo(projectId),
      workspacePlan(this.prisma, project.workspaceId),
    ]);
    const colors =
      logo?.source.kind === 'spec'
        ? logo.source.spec.colors
        : { primary: '#0f766e', secondary: '#f59e0b' };
    const apiUrl = this.config.getOrThrow<string>('API_URL');
    return {
      name: project.chosenName?.value ?? project.title,
      slogan: slogan?.text,
      logoUrl:
        logo && signatureId
          ? `${apiUrl}/api/v1/public/signatures/${signatureId}/logo.png?v=${logo.versionId.slice(0, 8)}`
          : null,
      primary: colors.primary,
      secondary: colors.secondary,
      poweredBy: plan.features.emailSignatureBranding ? POWERED_BY : null,
    };
  }

  /** Logo couleur sans fond, pour la signature e-mail. */
  logoSvg(source: LogoSource) {
    return source.kind === 'spec' ? renderLogoSvg(source.spec).svg : source.svg;
  }

  /**
   * Symbole du logo à l'encre du cachet (mode « logo »). Un logo importé en image matricielle
   * ne peut pas prendre l'encre : le cachet garde alors son texte central.
   */
  async stampMark(projectId: string, ink: string) {
    const logo = await this.logo(projectId);
    if (!logo) return null;
    const mark = markSvg(logo.source);
    if (/<image\b/i.test(mark)) return null;
    return recolorSvg(mark, ink);
  }
}
