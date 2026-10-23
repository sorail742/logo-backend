import {
  BadRequestException,
  BadGatewayException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerReason } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import type { Env } from '../../config/env';
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
const REMOVE_BG_URL = 'https://api.remove.bg/v1.0/removebg';
/** Un même appel répété (clé d'idempotence) renvoie le même masque sans nouveau débit. */
const IDEMPOTENCY_TTL_S = 15 * 60;

/**
 * Détourage d'une photo du Studio par IA (remove.bg) : 1 crédit, remboursé si le fournisseur
 * échoue. Le masque obtenu est enregistré dans l'élément image comme un détourage manuel.
 */
@Injectable()
export class StudioCutoutService {
  private readonly logger = new Logger(StudioCutoutService.name);
  private readonly apiKey: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('REMOVE_BG_API_KEY', { infer: true });
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async cutout(ctx: Ctx, image: string, idempotencyKey: string | undefined): Promise<CutoutResult> {
    if (!this.apiKey) {
      throw new HttpException(
        { message: 'Détourage par IA non activé sur cette plateforme', code: 'NOT_AVAILABLE' },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
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
        note: 'Détourage IA (Studio)',
      }),
    );
    let mask: Buffer;
    try {
      mask = await this.removeBackground(data);
    } catch (err) {
      await this.prisma.$transaction((tx) =>
        this.credits.credit(tx, {
          workspaceId: ctx.workspaceId,
          delta: cost,
          reason: LedgerReason.REFUND,
          actorId: ctx.actorId,
          note: 'Détourage IA en échec : crédit rendu',
        }),
      );
      this.logger.warn(`Détourage IA en échec : ${(err as Error).message}`);
      throw new BadGatewayException({
        message: 'Le service de détourage n’a pas répondu ; votre crédit a été rendu',
        code: 'PROVIDER_ERROR',
      });
    }
    const result: CutoutResult = {
      mask: `data:image/png;base64,${mask.toString('base64')}`,
      costCredits: cost,
    };
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL_S);
    return result;
  }

  /** Masque alpha du sujet (PNG en niveaux de gris) renvoyé par remove.bg. */
  private async removeBackground(image: Buffer): Promise<Buffer> {
    const body = new FormData();
    body.set('image_file_b64', image.toString('base64'));
    body.set('size', 'auto');
    body.set('format', 'png');
    body.set('channels', 'alpha');
    const response = await fetch(REMOVE_BG_URL, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey!, Accept: 'image/png' },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`remove.bg ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
    const png = Buffer.from(await response.arrayBuffer());
    if (png.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('Réponse non PNG');
    return png;
  }
}
