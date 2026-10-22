import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Website, type WebsiteMedia } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import { readableOn } from '../../render/color';
import { closestWeight, getFont } from '../../render/fonts';
import { getIcon, searchIcons } from '../../render/icons';
import {
  defaultSiteContent,
  siteMediaIds,
  SITE_SOCIALS,
  type SiteContent,
  type SiteSocial,
} from '../../render/site';
import { parseSiteContent, SITE_SLUG } from '../../render/site-schema';
import { emailSignatureDataSchema } from '../../render/email-signature';
import { NotificationsService } from '../notifications/notifications.service';
import { WebsiteRenderService, type SiteBrand, type SiteRecord } from './website-render.service';
import type { AddWebsiteMediaDto, SiteMessageDto, UpdateWebsiteDto } from './websites.dto';

/** Images téléversées par site, et taille maximale de chacune. */
export const MAX_SITE_MEDIA = 24;
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

/** Adresses réservées : elles prêteraient à confusion avec la plateforme. */
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'site', 'sites', 'www', 'aide', 'support']);

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

type SiteRow = Website & { media: WebsiteMedia[] };

/**
 * Site web de la marque : une page complète générée depuis le projet (nom, brief, slogan,
 * logo, coordonnées de la signature e-mail), modifiée dans l'éditeur, publiée sous
 * /site/<adresse> ou exportée en ZIP. Les messages du formulaire arrivent dans l'espace.
 */
@Injectable()
export class WebsitesService {
  private readonly logger = new Logger(WebsitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly render: WebsiteRenderService,
    private readonly notifications: NotificationsService,
  ) {}

  async get(projectId: string) {
    const site = await this.prisma.website.findUnique({
      where: { projectId },
      include: { media: { orderBy: { createdAt: 'asc' } } },
    });
    return { website: site ? await this.present(site) : null };
  }

  async create(projectId: string) {
    const existing = await this.prisma.website.findUnique({
      where: { projectId },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException({ message: 'Ce projet a déjà un site web', code: 'SITE_EXISTS' });
    const logo = await this.render.logo(projectId, null);
    if (!logo) {
      throw new BadRequestException({
        message: 'Créez d’abord un logo : le site reprend votre identité visuelle',
        code: 'NO_LOGO',
      });
    }
    const { name, content } = await this.defaults(projectId, logo.source);
    const slug = await this.freeSlug(name);
    try {
      const site = await this.prisma.website.create({
        data: { projectId, slug, content: content as unknown as Prisma.InputJsonValue },
        include: { media: true },
      });
      return this.present(site);
    } catch (err) {
      // Deux créations simultanées : la contrainte d'unicité tranche.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'Ce projet a déjà un site web',
          code: 'SITE_EXISTS',
        });
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateWebsiteDto) {
    const site = await this.find(id);
    const data: Prisma.WebsiteUpdateInput = {};
    if (dto.content !== undefined) {
      const content = this.parse(dto.content);
      const owned = new Set(site.media.map((m) => m.id));
      if (siteMediaIds(content).some((mid) => !owned.has(mid))) {
        throw new BadRequestException('Image inconnue dans le contenu du site');
      }
      data.content = content as unknown as Prisma.InputJsonValue;
    }
    if (dto.slug !== undefined && dto.slug !== site.slug) {
      data.slug = await this.checkSlug(dto.slug, site.id);
    }
    if (dto.logoId !== undefined) {
      if (dto.logoId) {
        const logo = await this.prisma.logo.findFirst({
          where: { id: dto.logoId, projectId: site.projectId },
          select: { id: true },
        });
        if (!logo) throw new BadRequestException('Logo introuvable dans ce projet');
      }
      data.logoId = dto.logoId;
    }
    try {
      const updated = await this.prisma.website.update({
        where: { id },
        data,
        include: { media: { orderBy: { createdAt: 'asc' } } },
      });
      return this.present(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          message: 'Cette adresse est déjà prise',
          code: 'SLUG_TAKEN',
        });
      }
      throw err;
    }
  }

  /** Publication (ou republication des modifications) : rendu complet, puis mise en ligne. */
  async publish(id: string) {
    const site = await this.find(id);
    const brand = await this.brandOf(site);
    const html = await this.render.publish(this.record(site), brand);
    // Même horodatage pour la publication et la modification : le site n'a plus d'écart.
    const now = new Date();
    const updated = await this.prisma.website.update({
      where: { id },
      data: { html, published: true, publishedAt: now, updatedAt: now },
      include: { media: { orderBy: { createdAt: 'asc' } } },
    });
    return this.present(updated);
  }

  async unpublish(id: string) {
    await this.find(id);
    const updated = await this.prisma.website.update({
      where: { id },
      data: { published: false, html: null },
      include: { media: { orderBy: { createdAt: 'asc' } } },
    });
    return this.present(updated);
  }

  async remove(id: string) {
    const site = await this.find(id);
    await this.prisma.website.delete({ where: { id } });
    const keys = [...this.render.storedKeys(id), ...site.media.map((m) => m.storageKey)];
    await Promise.all(keys.map((key) => this.storage.delete(key).catch(() => undefined)));
    return { slug: site.slug };
  }

  async addMedia(id: string, dto: AddWebsiteMediaDto) {
    const site = await this.find(id);
    if (site.media.length >= MAX_SITE_MEDIA) {
      throw new BadRequestException(`${MAX_SITE_MEDIA} images au plus par site`);
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dto.dataUrl);
    const mimeType = match?.[1] ?? '';
    const data = Buffer.from(match?.[2] ?? '', 'base64');
    if (!match || !MAGIC[mimeType]?.(data)) {
      throw new BadRequestException('Image JPEG, PNG ou WebP attendue');
    }
    if (data.length > MAX_MEDIA_BYTES) throw new BadRequestException('Image de 4 Mo au plus');
    const media = await this.prisma.websiteMedia.create({
      data: {
        websiteId: id,
        storageKey: '',
        mimeType,
        sizeBytes: data.length,
        alt: dto.alt?.trim() ?? '',
      },
    });
    const storageKey = `sites/${id}/media/${media.id}`;
    await this.storage.put(storageKey, data, mimeType);
    await this.prisma.websiteMedia.update({ where: { id: media.id }, data: { storageKey } });
    return { id: media.id, url: this.render.mediaUrl(media.id), alt: media.alt };
  }

  /** Suppression d'une image : ses emplois dans le contenu disparaissent avec elle. */
  async removeMedia(id: string, mediaId: string) {
    const site = await this.find(id);
    const media = site.media.find((m) => m.id === mediaId);
    if (!media) throw new NotFoundException('Image introuvable');
    const content = site.content as unknown as SiteContent;
    const sections = content.sections.map((section) => {
      if (
        section.type === 'hero' &&
        section.image?.kind === 'media' &&
        section.image.id === mediaId
      ) {
        return { ...section, image: null };
      }
      if (section.type === 'gallery') {
        return {
          ...section,
          images: section.images.filter((img) => img.kind !== 'media' || img.id !== mediaId),
        };
      }
      return section;
    });
    const changed = siteMediaIds(content).includes(mediaId);
    await this.prisma.$transaction([
      this.prisma.websiteMedia.delete({ where: { id: mediaId } }),
      ...(changed
        ? [
            this.prisma.website.update({
              where: { id },
              data: { content: { ...content, sections } as unknown as Prisma.InputJsonValue },
            }),
          ]
        : []),
    ]);
    await this.storage.delete(media.storageKey).catch(() => undefined);
    return this.present(await this.find(id));
  }

  async messages(id: string) {
    await this.find(id);
    const items = await this.prisma.websiteMessage.findMany({
      where: { websiteId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items };
  }

  async markMessage(id: string, messageId: string, read: boolean) {
    const message = await this.prisma.websiteMessage.findFirst({
      where: { id: messageId, websiteId: id },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message introuvable');
    return this.prisma.websiteMessage.update({
      where: { id: messageId },
      data: { readAt: read ? new Date() : null },
    });
  }

  async removeMessage(id: string, messageId: string) {
    const { count } = await this.prisma.websiteMessage.deleteMany({
      where: { id: messageId, websiteId: id },
    });
    if (!count) throw new NotFoundException('Message introuvable');
  }

  /** Archive autonome du site (offres payantes), servie par une URL signée. */
  async exportZip(id: string) {
    const site = await this.find(id);
    const brand = await this.brandOf(site);
    if (brand.free) {
      throw new ForbiddenException({
        message: 'L’export du site est inclus dans les offres payantes',
        code: 'PLAN_REQUIRED',
      });
    }
    const zip = await this.render.exportZip(this.record(site), brand, site.media);
    const key = `sites/${id}/export.zip`;
    await this.storage.put(key, zip, 'application/zip');
    return { url: await this.storage.signedUrl(key, { fileName: `site-${site.slug}.zip` }) };
  }

  // ─── Routes publiques ───

  /** Page d'un site en ligne ; la visite est comptée sans toucher à sa date de modification. */
  async publicHtml(slug: string) {
    const site = await this.prisma.website.findUnique({
      where: { slug },
      select: { id: true, html: true, published: true, project: { select: { deletedAt: true } } },
    });
    if (!site?.published || !site.html || site.project.deletedAt) {
      throw new NotFoundException('Site introuvable');
    }
    await this.prisma
      .$executeRaw`UPDATE "Website" SET "views" = "views" + 1 WHERE "id" = ${site.id}`;
    return site.html;
  }

  async publicFile(siteId: string, name: string) {
    const site = await this.prisma.website.findUnique({
      where: { id: siteId },
      select: { published: true },
    });
    const file = site?.published ? await this.render.publishedFile(siteId, name) : null;
    if (!file) throw new NotFoundException('Fichier introuvable');
    return file;
  }

  /** Image téléversée : identifiant aléatoire, servie à l'aperçu de l'éditeur comme au site. */
  async publicMedia(mediaId: string) {
    const media = await this.prisma.websiteMedia.findUnique({
      where: { id: mediaId },
      select: { storageKey: true, mimeType: true },
    });
    if (!media?.storageKey) throw new NotFoundException('Image introuvable');
    const data = await this.storage.get(media.storageKey).catch(() => null);
    if (!data) throw new NotFoundException('Image introuvable');
    return { data, mimeType: media.mimeType };
  }

  /** Message du formulaire de contact : enregistré, puis signalé aux propriétaires de l'espace. */
  async receiveMessage(siteId: string, dto: SiteMessageDto) {
    const site = await this.prisma.website.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true, title: true, deletedAt: true } },
      },
    });
    if (!site || site.project.deletedAt) throw new NotFoundException('Site introuvable');
    // Champ piège rempli : un robot. Réponse identique, rien n'est enregistré.
    if (dto.website?.trim()) return { ok: true };
    const name = dto.name.trim();
    const message = dto.message.trim();
    if (!name || !message) throw new BadRequestException('Nom et message requis');
    await this.prisma.websiteMessage.create({
      data: {
        websiteId: site.id,
        name,
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        message,
      },
    });
    const excerpt = message.length > 160 ? message.slice(0, 157) + '…' : message;
    try {
      await this.notifications.notifyOwners(
        site.project.workspaceId,
        {
          type: 'SITE_MESSAGE',
          title: `Nouveau message sur le site « ${site.project.title} »`,
          body: `${name} : ${excerpt}`,
          href: `/app/projets/${site.projectId}/site`,
        },
        { email: true },
      );
    } catch (err) {
      this.logger.warn(`Notification de message non envoyée : ${(err as Error).message}`);
    }
    return { ok: true };
  }

  // ─── Interne ───

  private async find(id: string): Promise<SiteRow> {
    const site = await this.prisma.website.findUnique({
      where: { id },
      include: { media: { orderBy: { createdAt: 'asc' } } },
    });
    if (!site) throw new NotFoundException('Site introuvable');
    return site;
  }

  private record(site: SiteRow): SiteRecord {
    return {
      id: site.id,
      projectId: site.projectId,
      slug: site.slug,
      logoId: site.logoId,
      content: this.parse(site.content),
    };
  }

  private async brandOf(site: SiteRow): Promise<SiteBrand> {
    const brand = await this.render.brand(site);
    if (!brand) {
      throw new BadRequestException({
        message: 'Le projet n’a plus de logo : créez-en un pour publier le site',
        code: 'NO_LOGO',
      });
    }
    return brand;
  }

  private parse(raw: unknown): SiteContent {
    const parsed = parseSiteContent(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Contenu du site invalide',
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return parsed.data;
  }

  private async present(site: SiteRow) {
    const [unread, brand] = await Promise.all([
      this.prisma.websiteMessage.count({ where: { websiteId: site.id, readAt: null } }),
      this.render.identity(site),
    ]);
    return {
      id: site.id,
      projectId: site.projectId,
      slug: site.slug,
      logoId: site.logoId,
      content: site.content as unknown as SiteContent,
      published: site.published,
      publishedAt: site.publishedAt,
      /** Modifications enregistrées depuis la dernière publication. */
      dirty: site.published && !!site.publishedAt && site.updatedAt > site.publishedAt,
      views: site.views,
      url: this.render.siteUrl(site.slug),
      formUrl: this.render.formUrl(site.id),
      assetsUrl: this.render.publicUrl,
      media: site.media.map((m) => ({
        id: m.id,
        url: this.render.mediaUrl(m.id),
        alt: m.alt,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
      })),
      unreadMessages: unread,
      /** Logo affiché (le choisi, sinon le favori ou le plus récent) ; null si le projet n'en a plus. */
      displayedLogoId: brand?.logoId ?? null,
      /** Offre gratuite : mention de la plateforme imposée, export réservé. */
      free: brand?.free ?? true,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  }

  private async checkSlug(raw: string, siteId: string) {
    const slug = raw.trim().toLowerCase();
    if (!SITE_SLUG.test(slug) || RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException({
        message: 'Adresse invalide : 3 à 48 lettres minuscules, chiffres ou tirets',
        code: 'SLUG_INVALID',
      });
    }
    const taken = await this.prisma.website.findUnique({ where: { slug }, select: { id: true } });
    if (taken && taken.id !== siteId) {
      throw new ConflictException({ message: 'Cette adresse est déjà prise', code: 'SLUG_TAKEN' });
    }
    return slug;
  }

  /** Adresse libre tirée du nom de la marque (suffixe aléatoire en cas de doublon). */
  private async freeSlug(name: string) {
    let base = slugify(name);
    while (base.endsWith('-')) base = base.slice(0, -1);
    if (base.length < 3) base = `${base || 'mon'}-site`;
    if (RESERVED_SLUGS.has(base)) base = `${base}-site`;
    const candidates = [
      base,
      ...Array.from({ length: 5 }, () => `${base.slice(0, 40)}-${randomBytes(2).toString('hex')}`),
    ];
    const taken = await this.prisma.website.findMany({
      where: { slug: { in: candidates } },
      select: { slug: true },
    });
    const used = new Set(taken.map((t) => t.slug));
    const free = candidates.find((slug) => !used.has(slug));
    if (free) return free;
    return `${base.slice(0, 32)}-${randomBytes(6).toString('hex')}`;
  }

  /** Contenu de départ : nom, brief, slogan et mission retenus, logo, signature e-mail. */
  private async defaults(projectId: string, source: SiteBrand['source']) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        title: true,
        chosenName: { select: { value: true } },
        brief: {
          select: { sector: true, mission: true, values: true, audience: true, languages: true },
        },
        slogans: { where: { isChosen: true }, select: { text: true, kind: true } },
        signatures: {
          where: { kind: 'EMAIL' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { data: true },
        },
      },
    });
    const name = project.chosenName?.value ?? project.title;
    const chosen = (kind: string) => project.slogans.find((s) => s.kind === kind)?.text ?? null;
    const brief = project.brief;
    const signature = emailSignatureDataSchema.safeParse(project.signatures[0]?.data ?? null);
    const card = signature.success ? signature.data : null;

    const content = defaultSiteContent({
      name,
      slogan: chosen('SLOGAN'),
      mission: chosen('MISSION') ?? brief?.mission ?? null,
      sector: brief?.sector ?? null,
      values: brief?.values ?? [],
      audience: brief?.audience ?? null,
      language: brief?.languages[0] === 'en' ? 'en' : 'fr',
      ...brandStyle(source),
      contact: {
        phone: card?.phones.find(Boolean) ?? '',
        email: card?.email ?? '',
        address: card?.address ?? '',
      },
      social: card ? socialsOf(card.socials) : {},
      icons: sectorIcons(brief?.sector ?? ''),
    });
    return { name, content };
  }
}

/** Couleurs et polices du logo ; un fond de logo foncé laisse place à un fond de page blanc. */
function brandStyle(source: SiteBrand['source']): Pick<SiteContent, 'colors' | 'fonts'> {
  if (source.kind === 'svg') {
    const dark = readableOn(source.background) === '#ffffff';
    const primary = dark ? source.background : '#111827';
    return {
      colors: { primary, secondary: '#f59e0b', text: '#111827', background: '#ffffff' },
      fonts: { heading: { id: 'montserrat', weight: 700 }, body: { id: 'inter', weight: 400 } },
    };
  }
  const { spec } = source;
  const darkBackground = readableOn(spec.colors.background) === '#ffffff';
  const heading = { id: spec.fontId, weight: closestWeight(spec.fontId, spec.fontWeight) };
  const body =
    getFont(spec.fontId).category === 'sans'
      ? { id: spec.fontId, weight: closestWeight(spec.fontId, 400) }
      : { id: 'inter', weight: 400 };
  return {
    colors: {
      primary: spec.colors.primary,
      secondary: spec.colors.secondary,
      text: darkBackground ? '#111827' : spec.colors.text,
      background: darkBackground ? '#ffffff' : spec.colors.background,
    },
    fonts: { heading, body },
  };
}

const NETWORKS: Record<string, SiteSocial> = { twitter: 'x' };

function socialsOf(list: { network: string; url: string }[]) {
  const social: Partial<Record<SiteSocial, string>> = {};
  for (const { network, url } of list) {
    const key = network.trim().toLowerCase();
    const id = NETWORKS[key] ?? key;
    if (url.trim() && (SITE_SOCIALS as readonly string[]).includes(id)) {
      social[id as SiteSocial] = url.trim().slice(0, 300);
    }
  }
  return social;
}

/** Icônes des services : celles du secteur (mot à mot), complétées par des icônes neutres. */
function sectorIcons(sector: string) {
  const words = sector.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const found = words.flatMap((w) => searchIcons(w).map((icon) => icon.id));
  return [...new Set([...found, 'star', 'sparkles', 'heart'])]
    .filter((id) => !!getIcon(id))
    .slice(0, 3);
}
