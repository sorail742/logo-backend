import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AssetKind, JobKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { imageGenerationInputSchema, type ImageGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { AiProvider } from '../ai/ai-provider';
import { JobsService } from '../jobs/jobs.service';
import { ModerationService } from '../moderation/moderation.service';
import type { GenerateStudioImagesDto } from './studio.dto';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

/** Résultat enregistré dans GenerationJob.result ; chaque image est servie par URL signée. */
export interface StudioImagesResult {
  images: { assetId: string; storageKey: string; width: number; height: number }[];
  provider: string;
  demo: boolean;
}

const IMAGES_PER_BATCH = 4;
const DEFAULT_PALETTE = ['#0f6b5c', '#f2b705', '#14281d', '#f6fbf4'];

/** Images du Studio : lot de 4 propositions produit par le worker, à poser sur une création. */
@Injectable()
export class StudioImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly moderation: ModerationService,
    private readonly ai: AiProvider,
    private readonly storage: StorageService,
  ) {}

  async request(ctx: Ctx, dto: GenerateStudioImagesDto, idempotencyKey: string | undefined) {
    // La description est une donnée : elle passe la liste noire comme un slogan (§14.1).
    const blocked = await this.moderation.findBlocked(dto.prompt, 'SLOGAN');
    if (blocked.length) {
      throw new UnprocessableEntityException({
        message: 'Cette description contient un terme refusé',
        code: 'TERM_BLOCKED',
      });
    }
    const input: ImageGenerationInput = imageGenerationInputSchema.parse({
      prompt: dto.prompt,
      style: dto.style,
      aspect: dto.aspect,
      palette: dto.palette ?? (await this.projectPalette(ctx.projectId)),
      count: IMAGES_PER_BATCH,
    });
    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.STUDIO_IMAGES,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.STUDIO_IMAGES,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }

  async runJob(jobId: string): Promise<StudioImagesResult> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { project: { select: { workspaceId: true } } },
    });
    const input = imageGenerationInputSchema.parse(job.input);
    const outcome = await this.ai.generateImages(input);
    const images: StudioImagesResult['images'] = await Promise.all(
      outcome.images.map(async (image, index) => {
        const name = `image-${index + 1}.png`;
        const storageKey = `studio-images/${job.project.workspaceId}/${job.projectId}/${jobId}/${name}`;
        await this.storage.put(storageKey, image.data, 'image/png');
        const asset = await this.prisma.asset.create({
          data: {
            kind: AssetKind.GENERATED,
            name,
            storageKey,
            mimeType: 'image/png',
            sizeBytes: image.data.length,
            tags: [`project:${job.projectId}`, `job:${jobId}`],
          },
        });
        return { assetId: asset.id, storageKey, width: image.width, height: image.height };
      }),
    );
    const result: StudioImagesResult = { images, provider: outcome.provider, demo: outcome.demo };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        result: result as unknown as Prisma.InputJsonValue,
        provider: outcome.provider,
        promptVersion: outcome.promptVersion,
        costUsdMicros: outcome.costUsdMicros,
      },
    });
    return result;
  }

  /** Couleurs du logo favori (ou du plus récent) du projet. */
  private async projectPalette(projectId: string) {
    const logo = await this.prisma.logo.findFirst({
      where: { projectId },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      select: { versions: { orderBy: { number: 'desc' }, take: 1, select: { spec: true } } },
    });
    const colors = (logo?.versions[0]?.spec as { colors?: Record<string, string> } | undefined)
      ?.colors;
    const palette = colors
      ? [colors.primary, colors.secondary, colors.text, colors.background].filter(
          (c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c),
        )
      : [];
    return palette.length >= 2 ? palette : DEFAULT_PALETTE;
  }
}
