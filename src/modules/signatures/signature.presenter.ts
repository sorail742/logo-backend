import type { Prisma } from '@prisma/client';

/** Modèle exposé par sa clé stable (« classic », « round »…), partagée avec le front. */
export const SIGNATURE_INCLUDE = {
  template: { select: { key: true } },
} satisfies Prisma.SignatureInclude;

type SignatureRow = Prisma.SignatureGetPayload<{ include: typeof SIGNATURE_INCLUDE }>;

/** Signature (type Signature du front) ; l'emplacement du fichier privé n'est jamais exposé. */
export function toSignatureDto({ template, fileKey: _fileKey, ...signature }: SignatureRow) {
  return { ...signature, templateId: template?.key ?? null };
}
