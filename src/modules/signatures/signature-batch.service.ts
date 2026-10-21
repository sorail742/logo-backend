import { Injectable } from '@nestjs/common';
import { AssetKind, Prisma, SignatureKind } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import {
  EMAIL_TEMPLATE_KEYS,
  emailSignatureDataSchema,
  renderEmailSignature,
  renderEmailSignatureText,
} from '../../render/email-signature';
import { createZip, type ZipEntry } from '../../render/zip';
import { EXPORT_RETENTION_DAYS } from '../logos/logo-export.service';
import { SignatureBrandService } from './signature-brand.service';

/** Entrée d'une tâche SIGNATURE (SIG-16), figée au moment de l'import. */
export const signatureBatchInputSchema = z.object({
  signatureId: z.string().uuid(),
  templateId: z.enum(EMAIL_TEMPLATE_KEYS),
  members: z
    .array(
      z.object({
        fullName: z.string().min(1),
        jobTitle: z.string(),
        email: z.string(),
        phone: z.string(),
      }),
    )
    .min(1),
});
export type SignatureBatchInput = z.infer<typeof signatureBatchInputSchema>;

/** Signatures e-mail en lot, produites par le worker : une page HTML et un texte par membre. */
@Injectable()
export class SignatureBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly brands: SignatureBrandService,
  ) {}

  async runJob(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { project: { select: { workspaceId: true } } },
    });
    const input = signatureBatchInputSchema.parse(job.input);
    const base = await this.prisma.signature.findFirstOrThrow({
      where: { id: input.signatureId, kind: SignatureKind.EMAIL },
    });
    const data = emailSignatureDataSchema.parse(base.data);
    const brand = await this.brands.brand(job.projectId, base.id);

    const used = new Set<string>();
    const entries: ZipEntry[] = [];
    for (const member of input.members) {
      // Une adresse invalide dans le CSV est ignorée plutôt que de faire échouer tout le lot.
      const email = z.string().email().safeParse(member.email).success ? member.email : '';
      const memberData = {
        ...data,
        fullName: member.fullName,
        jobTitle: member.jobTitle,
        email,
        phones: member.phone ? [member.phone] : [],
      };
      const slug = uniqueSlug(slugify(member.fullName) || 'membre', used);
      entries.push(
        {
          path: `${slug}.html`,
          data: Buffer.from(
            `<!doctype html><meta charset="utf-8"><title>${slug}</title>${renderEmailSignature(input.templateId, memberData, brand)}`,
          ),
        },
        { path: `${slug}.txt`, data: Buffer.from(renderEmailSignatureText(memberData, brand)) },
      );
    }
    const zip = createZip(entries);

    const fileName = `signatures-${slugify(brand.name) || 'equipe'}.zip`;
    const storageKey = `exports/${job.project.workspaceId}/${jobId}/${fileName}`;
    await this.storage.put(storageKey, zip, 'application/zip');
    const asset = await this.prisma.asset.create({
      data: {
        kind: AssetKind.EXPORT,
        name: fileName,
        storageKey,
        mimeType: 'application/zip',
        sizeBytes: zip.length,
        tags: [`signature:${base.id}`, `job:${jobId}`],
      },
    });
    const result = {
      assetId: asset.id,
      storageKey,
      fileName,
      sizeBytes: zip.length,
      count: input.members.length,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
    };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { result: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  }
}

function uniqueSlug(slug: string, used: Set<string>) {
  let candidate = slug;
  let i = 1;
  while (used.has(candidate)) candidate = `${slug}-${++i}`;
  used.add(candidate);
  return candidate;
}
