import {
  BadRequestException,
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { LedgerReason } from '@prisma/client';
import type Redis from 'ioredis';
import sharp from 'sharp';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import { MAX_IMAGE_BYTES } from '../../render/design-doc';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { CreditsService } from '../credits/credits.service';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

export interface CutoutResult {
  /** Masque PNG en niveaux de gris (blanc = sujet), en data URL. */
  mask: string;
  costCredits: number;
}

const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
/** Un même appel répété (clé d'idempotence) renvoie le même masque sans nouveau débit. */
const IDEMPOTENCY_TTL_S = 15 * 60;

/**
 * Détourage d'une photo du Studio 100% local via Sharp (ZÉRO API externe).
 * 1 crédit, remboursé en cas d'erreur de traitement.
 */
@Injectable()
export class StudioCutoutService {
  private readonly logger = new Logger(StudioCutoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get enabled() {
    return true;
  }

  async cutout(ctx: Ctx, image: string, idempotencyKey: string | undefined): Promise<CutoutResult> {
    if (!idempotencyKey) throw new BadRequestException('En-tête Idempotency-Key requis');
    const match = IMAGE_DATA_URL.exec(image);
    const data = match ? Buffer.from(match[2], 'base64') : null;
    if (!data?.length || data.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image PNG ou JPEG de 4 Mo au plus attendue');
    }

    const cacheKey = `studio-cutout:${ctx.workspaceId}:${idempotencyKey}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CutoutResult;

    const cost = CREDIT_COSTS.STUDIO_CUTOUT;
    await this.prisma.$transaction((tx) =>
      this.credits.debit(tx, {
        workspaceId: ctx.workspaceId,
        amount: cost,
        reason: LedgerReason.GENERATION,
        actorId: ctx.actorId,
        note: 'Détourage local (Studio)',
      }),
    );

    let mask: Buffer;
    try {
      mask = await this.removeBackgroundLocal(data);
    } catch (err) {
      await this.prisma.$transaction((tx) =>
        this.credits.credit(tx, {
          workspaceId: ctx.workspaceId,
          delta: cost,
          reason: LedgerReason.REFUND,
          actorId: ctx.actorId,
          note: 'Détourage en échec : crédit rendu',
        }),
      );
      this.logger.warn(`Détourage en échec : ${(err as Error).message}`);
      throw new BadGatewayException({
        message: 'Le traitement de l’image a échoué ; votre crédit a été rendu',
        code: 'PROCESSING_ERROR',
      });
    }

    const result: CutoutResult = {
      mask: `data:image/png;base64,${mask.toString('base64')}`,
      costCredits: cost,
    };
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL_S);
    return result;
  }

  /**
   * Masque alpha du sujet (PNG en niveaux de gris) généré 100% en local via Sharp.
   * Si l'image possède un canal alpha significatif, on l'extrait.
   * Sinon, on détecte la couleur de fond de bordure (chroma/luma difference) pour créer le masque.
   */
  private async removeBackgroundLocal(image: Buffer): Promise<Buffer> {
    const s = sharp(image);
    const metadata = await s.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (!width || !height) throw new Error('Dimensions d’image invalides');

    const { data, info } = await s
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Vérifier si l'image a déjà de la transparence
    let hasTransparentPixels = false;
    for (let i = 0; i < width * height; i++) {
      if (data[i * 4 + 3] < 250) {
        hasTransparentPixels = true;
        break;
      }
    }

    const maskData = new Uint8Array(width * height);

    if (hasTransparentPixels) {
      // Extraire le canal alpha existant (binarisé / lissé)
      for (let i = 0; i < width * height; i++) {
        maskData[i] = data[i * 4 + 3];
      }
    } else {
      // Pas de canal alpha : échantillonner les coins pour détecter la couleur de fond
      // Coin haut-gauche
      const bgR = data[0];
      const bgG = data[1];
      const bgB = data[2];

      // Tolérance euclidienne sur la couleur de fond
      const tolerance = 35;
      const toleranceSq = tolerance * tolerance;

      for (let i = 0; i < width * height; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        const distSq = dr * dr + dg * dg + db * db;

        if (distSq <= toleranceSq) {
          maskData[i] = 0; // Fond
        } else {
          maskData[i] = 255; // Sujet
        }
      }
    }

    return sharp(maskData, {
      raw: {
        width,
        height,
        channels: 1,
      },
    })
      .png()
      .toBuffer();
  }
}
