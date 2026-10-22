import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import type { Env } from '../../config/env';
import type { BrandAssets } from '../../render/compose';
import { closestWeight, FONTS_DIR, getFont, isLibraryFont } from '../../render/fonts';
import { brandAssets, type LogoSource } from '../../render/logo-assets';
import { MOCKUP_SCENES, mockupSvg } from '../../render/mockups';
import { svgToJpeg, svgToPng } from '../../render/raster';
import {
  renderSiteHtml,
  siteMediaIds,
  siteMockupScenes,
  type SiteContent,
  type SiteUrls,
} from '../../render/site';
import { socialKitSvg, type SocialFormat } from '../../render/social-kit';
import { createZip, type ZipEntry } from '../../render/zip';
import { workspacePlan } from '../billing/plan-features';
import { logoSource } from '../logos/logo-source';

/** Nom de la plateforme dans la mention en pied de page (même libellé que le front). */
export const PLATFORM_NAME = 'Marka';

/** Fichiers d'un site publié servis publiquement (image de partage, icônes, mises en situation). */
export const SITE_FILE = /^(?:og|favicon|icon-180)\.png$|^mockup-[a-z]{2,20}\.jpg$/;

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Image de partage (Open Graph) : 1200 × 630, logo dans la zone centrale. */
const OG_FORMAT: SocialFormat = {
  id: 'og',
  file: 'og',
  width: 1200,
  height: 630,
  kind: 'cover',
  safe: [0.2, 0.24, 0.6, 0.52],
};

export type FontSubset = 'latin' | 'latin-ext';

/** Fichier WOFF d'une police de la bibliothèque, à la graisse la plus proche ; null s'il n'existe pas. */
export function siteFontFile(id: string, weight: number, subset: FontSubset): string | null {
  if (!isLibraryFont(id)) return null;
  const files = getFont(id).files[String(closestWeight(id, weight))];
  return files?.[subset === 'latin' ? 0 : 1] ?? null;
}

export interface SiteRecord {
  id: string;
  projectId: string;
  slug: string;
  logoId: string | null;
  content: SiteContent;
}

export interface SiteMediaRecord {
  id: string;
  storageKey: string;
  mimeType: string;
}

/** Identité affichée par le site : nom retenu et logo (choisi, sinon favori ou plus récent). */
export interface SiteBrand {
  name: string;
  logoId: string;
  source: LogoSource;
  assets: BrandAssets;
  /** Offre gratuite : la mention de la plateforme reste affichée, l'export est réservé. */
  free: boolean;
}

interface RenderedFile {
  name: string;
  data: Buffer;
}

/**
 * Rendu du site : page HTML (même module que l'aperçu du front), image de partage, icônes et
 * mises en situation en JPG. Sert la publication et l'export ZIP.
 */
@Injectable()
export class WebsiteRenderService {
  private readonly appUrl: string;
  /** Base des routes publiques de l'API (fichiers, polices, formulaire). */
  readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.publicUrl = `${config.get('API_URL', { infer: true }).replace(/\/$/, '')}/api/v1/public`;
  }

  siteUrl(slug: string) {
    return `${this.appUrl}/site/${slug}`;
  }

  mediaUrl(mediaId: string) {
    return `${this.publicUrl}/site-media/${mediaId}`;
  }

  formUrl(siteId: string) {
    return `${this.publicUrl}/sites/${siteId}/messages`;
  }

  /** Version courante du logo choisi, à défaut du favori ou du plus récent du projet. */
  async logo(projectId: string, logoId: string | null) {
    const select = {
      id: true,
      engine: true,
      versions: {
        orderBy: { number: 'desc' as const },
        take: 1,
        select: { number: true, spec: true, svg: true },
      },
    };
    const chosen = logoId
      ? await this.prisma.logo.findFirst({ where: { id: logoId, projectId }, select })
      : null;
    const logo =
      chosen ??
      (await this.prisma.logo.findFirst({
        where: { projectId },
        orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
        select,
      }));
    const version = logo?.versions[0];
    if (!logo || !version) return null;
    return { logoId: logo.id, source: logoSource(logo, version) };
  }

  /** Nom, logo affiché et offre, sans rendu des variantes du logo. */
  async identity(
    site: Pick<SiteRecord, 'projectId' | 'logoId'>,
  ): Promise<Omit<SiteBrand, 'assets'> | null> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: site.projectId },
      select: { title: true, workspaceId: true, chosenName: { select: { value: true } } },
    });
    const [logo, plan] = await Promise.all([
      this.logo(site.projectId, site.logoId),
      workspacePlan(this.prisma, project.workspaceId),
    ]);
    if (!logo) return null;
    return {
      name: project.chosenName?.value ?? project.title,
      logoId: logo.logoId,
      source: logo.source,
      free: !!plan.features.watermark,
    };
  }

  async brand(site: Pick<SiteRecord, 'projectId' | 'logoId'>): Promise<SiteBrand | null> {
    const identity = await this.identity(site);
    return identity && { ...identity, assets: brandAssets(identity.source) };
  }

  html(site: SiteRecord, brand: SiteBrand, urls: SiteUrls) {
    const { assets } = brand;
    return renderSiteHtml({
      content: { ...site.content, credit: site.content.credit || brand.free },
      name: brand.name,
      logo: {
        color: assets.logo.color.svg,
        white: assets.logo.white.svg,
        mark: assets.mark.color.svg,
      },
      urls,
      platform: { name: PLATFORM_NAME, url: this.appUrl },
    });
  }

  /** Image de partage, icônes et mises en situation utilisées par le contenu. */
  files(content: SiteContent, assets: BrandAssets): RenderedFile[] {
    const mark = assets.mark.color.svg;
    const files: RenderedFile[] = [
      {
        name: 'og.png',
        data: svgToPng(socialKitSvg(assets, OG_FORMAT), { size: OG_FORMAT.width }),
      },
      { name: 'favicon.png', data: svgToPng(mark, { size: 64, square: true }) },
      {
        name: 'icon-180.png',
        data: svgToPng(mark, {
          size: 180,
          square: true,
          padding: 0.1,
          background: assets.colors.background,
        }),
      },
    ];
    for (const id of siteMockupScenes(content)) {
      const scene = MOCKUP_SCENES.find((s) => s.id === id);
      if (!scene) continue;
      files.push({
        name: `mockup-${scene.id}.jpg`,
        data: svgToJpeg(mockupSvg(assets, scene), { size: 1200, quality: 84 }),
      });
    }
    return files;
  }

  /** Publication : fichiers déposés dans le stockage, page rendue avec les URL publiques. */
  async publish(site: SiteRecord, brand: SiteBrand) {
    const files = this.files(site.content, brand.assets);
    await Promise.all(
      files.map((file) => this.storage.put(`sites/${site.id}/${file.name}`, file.data)),
    );
    const version = Date.now().toString(36);
    const fileUrl = (name: string) =>
      `${this.publicUrl}/sites/${site.id}/files/${name}?v=${version}`;
    return this.html(site, brand, {
      font: (id, weight, subset) =>
        siteFontFile(id, weight, subset)
          ? `${this.publicUrl}/site-fonts/${id}/${closestWeight(id, weight)}/${subset}`
          : null,
      media: (id) => this.mediaUrl(id),
      mockup: (scene) => fileUrl(`mockup-${scene}.jpg`),
      file: fileUrl,
      form: this.formUrl(site.id),
      canonical: this.siteUrl(site.slug),
    });
  }

  /** Fichier publié d'un site ; null s'il n'existe pas. */
  publishedFile(siteId: string, name: string): Promise<Buffer | null> {
    if (!SITE_FILE.test(name)) return Promise.resolve(null);
    return this.storage.get(`sites/${siteId}/${name}`).catch(() => null);
  }

  /** Clés de stockage d'un site (fichiers publiés, export), pour la suppression. */
  storedKeys(siteId: string) {
    return [
      'og.png',
      'favicon.png',
      'icon-180.png',
      'export.zip',
      ...MOCKUP_SCENES.map((s) => `mockup-${s.id}.jpg`),
    ].map((name) => `sites/${siteId}/${name}`);
  }

  /**
   * Archive autonome : index.html aux chemins relatifs, polices, images et icônes. Le
   * formulaire de contact continue d'envoyer les messages à la plateforme.
   */
  async exportZip(site: SiteRecord, brand: SiteBrand, media: SiteMediaRecord[]) {
    const fonts = new Map<string, string>();
    const used = new Set(siteMediaIds(site.content));
    const mediaPath = new Map(
      media
        .filter((m) => used.has(m.id))
        .map((m) => [m.id, `assets/media/${m.id}.${MEDIA_EXTENSIONS[m.mimeType] ?? 'jpg'}`]),
    );
    const html = this.html(site, brand, {
      font: (id, weight, subset) => {
        const file = siteFontFile(id, weight, subset);
        if (!file) return null;
        const path = `assets/fonts/${id}-${closestWeight(id, weight)}-${subset}.woff`;
        fonts.set(path, file);
        return path;
      },
      media: (id) => mediaPath.get(id) ?? '',
      mockup: (scene) => `assets/images/${scene}.jpg`,
      file: (name) => name,
      form: this.formUrl(site.id),
      canonical: null,
    });

    const entries: ZipEntry[] = [{ path: 'index.html', data: html }];
    for (const file of this.files(site.content, brand.assets)) {
      const scene = /^mockup-(.+)\.jpg$/.exec(file.name)?.[1];
      entries.push({ path: scene ? `assets/images/${scene}.jpg` : file.name, data: file.data });
    }
    const fontFiles = await Promise.all(
      [...fonts].map(async ([path, file]) => ({
        path,
        data: await readFile(join(FONTS_DIR, file)),
      })),
    );
    const mediaFiles = await Promise.all(
      media
        .filter((m) => mediaPath.has(m.id))
        .map(async (m) => ({
          path: mediaPath.get(m.id)!,
          data: await this.storage.get(m.storageKey),
        })),
    );
    entries.push(...fontFiles, ...mediaFiles, { path: 'LISEZ-MOI.txt', data: readme(brand.name) });
    return createZip(entries);
  }
}

function readme(name: string) {
  return [
    `Site web de ${name}`,
    '',
    'Ce dossier contient un site complet, prêt à héberger : déposez son contenu tel quel sur',
    'n’importe quel hébergement statique (Netlify, Vercel, GitHub Pages, cPanel, etc.).',
    '',
    '- index.html : la page du site (styles et script intégrés) ;',
    '- assets/ : polices (licence OFL), images et mises en situation ;',
    '- og.png, favicon.png, icon-180.png : image de partage et icônes.',
    '',
    'Le formulaire de contact envoie les messages à votre espace sur la plateforme : vous les',
    'retrouvez dans l’onglet « Site web » du projet.',
    '',
  ].join('\n');
}
