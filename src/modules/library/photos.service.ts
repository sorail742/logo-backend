import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { z } from 'zod';
import { REDIS } from '../../common/redis/redis.module';
import type { Env } from '../../config/env';

// Banque de photos du Studio : recherche Pexels (licence libre, attribution appréciée) et
// téléchargement par l'API, pour que le navigateur n'ait affaire qu'à une seule origine.

const API_URL = 'https://api.pexels.com/v1';
const PER_PAGE = 24;
const TIMEOUT_MS = 8000;
const SEARCH_TTL_S = 3600;
const PHOTO_TTL_S = 86400;
/** Côté maximal téléchargé : le Studio réduit de toute façon à 2 400 px. */
const DOWNLOAD_SIDE = 2400;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PhotoOrientation = 'landscape' | 'portrait' | 'square';

export interface LibraryPhoto {
  id: string;
  width: number;
  height: number;
  alt: string;
  /** Couleur moyenne, pour le fond pendant le chargement de la vignette. */
  color: string | null;
  thumbUrl: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
  source: 'pexels';
}

export interface PhotoPage {
  photos: LibraryPhoto[];
  page: number;
  hasMore: boolean;
}

// Réponse d'un service tiers : validée champ par champ, une photo mal formée est écartée.
const pexelsPhoto = z.object({
  id: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  url: z.string().url(),
  photographer: z.string().max(200),
  photographer_url: z.string().url(),
  avg_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish()
    .catch(null),
  alt: z.string().max(500).nullish(),
  src: z.object({ original: z.string().url(), medium: z.string().url() }),
});
type PexelsPhoto = z.infer<typeof pexelsPhoto>;

const pexelsPage = z.object({
  page: z.number().int().positive(),
  photos: z.array(z.unknown()),
  next_page: z.string().nullish(),
});

const onHost = (url: string, host: string) => {
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.hostname === host;
};

function normalize(raw: unknown): LibraryPhoto | null {
  const parsed = pexelsPhoto.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  // Seules les adresses de Pexels sont relayées au navigateur.
  if (!onHost(p.src.medium, 'images.pexels.com') || !onHost(p.url, 'www.pexels.com')) return null;
  return {
    id: String(p.id),
    width: p.width,
    height: p.height,
    alt: p.alt?.trim() ?? '',
    color: p.avg_color ?? null,
    thumbUrl: p.src.medium,
    author: p.photographer,
    authorUrl: onHost(p.photographer_url, 'www.pexels.com') ? p.photographer_url : p.url,
    pageUrl: p.url,
    source: 'pexels',
  };
}

/** Page de résultats Pexels → photos de la bibliothèque. */
export function normalizePage(raw: unknown): PhotoPage {
  const parsed = pexelsPage.safeParse(raw);
  if (!parsed.success)
    throw new BadGatewayException({
      message: 'Réponse inattendue de la banque de photos',
      code: 'PHOTOS_UNAVAILABLE',
    });
  return {
    photos: parsed.data.photos.map(normalize).filter((p): p is LibraryPhoto => p !== null),
    page: parsed.data.page,
    hasMore: Boolean(parsed.data.next_page),
  };
}

/** Adresse de téléchargement : l'original, ramené à 2 400 px au plus sur le grand côté. */
export function downloadUrl(original: string) {
  if (!onHost(original, 'images.pexels.com'))
    throw new BadGatewayException({
      message: 'Adresse de photo refusée',
      code: 'PHOTOS_UNAVAILABLE',
    });
  const url = new URL(original);
  url.search = new URLSearchParams({
    auto: 'compress',
    cs: 'tinysrgb',
    fit: 'max',
    w: String(DOWNLOAD_SIDE),
    h: String(DOWNLOAD_SIDE),
  }).toString();
  return url.toString();
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);
  private readonly apiKey: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.apiKey = config.get('PEXELS_API_KEY', { infer: true });
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async search(input: {
    q?: string;
    page?: number;
    orientation?: PhotoOrientation;
    locale?: 'fr' | 'en';
  }): Promise<PhotoPage> {
    const query = input.q?.trim() ?? '';
    const params = new URLSearchParams({
      per_page: String(PER_PAGE),
      page: String(input.page ?? 1),
    });
    // Sans recherche : la sélection du moment.
    if (query) {
      params.set('query', query);
      params.set('locale', input.locale === 'en' ? 'en-US' : 'fr-FR');
      if (input.orientation) params.set('orientation', input.orientation);
    }
    return normalizePage(
      await this.call(`${query ? '/search' : '/curated'}?${params}`, SEARCH_TTL_S),
    );
  }

  /** Fichier d'une photo, téléchargé depuis Pexels (hôte, type et poids contrôlés). */
  async file(id: number): Promise<{ data: Buffer; contentType: string }> {
    const photo = pexelsPhoto.safeParse(await this.call(`/photos/${id}`, PHOTO_TTL_S));
    if (!photo.success)
      throw new BadGatewayException({
        message: 'Réponse inattendue de la banque de photos',
        code: 'PHOTOS_UNAVAILABLE',
      });
    return this.download(photo.data);
  }

  private async download(photo: PexelsPhoto) {
    const response = await this.fetch(downloadUrl(photo.src.original), {}, 'follow');
    if (!onHost(response.url, 'images.pexels.com'))
      throw new BadGatewayException({
        message: 'Adresse de photo refusée',
        code: 'PHOTOS_UNAVAILABLE',
      });
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!response.ok || !IMAGE_TYPES.includes(contentType)) {
      this.logger.warn(
        `Téléchargement Pexels refusé (${response.status}, ${contentType || 'type inconnu'})`,
      );
      throw new BadGatewayException({ message: 'Photo indisponible', code: 'PHOTOS_UNAVAILABLE' });
    }
    return { data: await readLimited(response, MAX_DOWNLOAD_BYTES), contentType };
  }

  private async call(path: string, ttl: number): Promise<unknown> {
    if (!this.apiKey) {
      throw new NotImplementedException({
        message: 'La banque de photos n’est pas activée sur cette plateforme',
        code: 'NOT_AVAILABLE',
      });
    }
    const cacheKey = `library:pexels:${createHash('sha1').update(path).digest('hex')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown;

    const response = await this.fetch(`${API_URL}${path}`, {
      Authorization: this.apiKey,
      Accept: 'application/json',
    });
    if (response.status === 404) throw new NotFoundException('Photo introuvable');
    if (response.status === 429) {
      throw new ServiceUnavailableException({
        message: 'La banque de photos est très sollicitée : réessayez dans quelques minutes',
        code: 'PHOTOS_RATE_LIMITED',
      });
    }
    if (!response.ok) {
      this.logger.warn(`Pexels ${path.split('?')[0]} : ${response.status}`);
      throw new BadGatewayException({
        message: 'Banque de photos injoignable',
        code: 'PHOTOS_UNAVAILABLE',
      });
    }
    const body = (await response.json()) as unknown;
    await this.redis.set(cacheKey, JSON.stringify(body), 'EX', ttl);
    return body;
  }

  private async fetch(
    url: string,
    headers: Record<string, string>,
    redirect: RequestRedirect = 'error',
  ) {
    try {
      return await fetch(url, { headers, redirect, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      this.logger.warn(`Pexels injoignable : ${(error as Error).message}`);
      throw new BadGatewayException({
        message: 'Banque de photos injoignable',
        code: 'PHOTOS_UNAVAILABLE',
      });
    }
  }
}

async function readLimited(response: Response, max: number) {
  if (Number(response.headers.get('content-length') ?? 0) > max)
    throw new BadGatewayException({ message: 'Photo trop lourde', code: 'PHOTOS_UNAVAILABLE' });
  const reader = response.body?.getReader();
  if (!reader)
    throw new BadGatewayException({ message: 'Photo indisponible', code: 'PHOTOS_UNAVAILABLE' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new BadGatewayException({ message: 'Photo trop lourde', code: 'PHOTOS_UNAVAILABLE' });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
