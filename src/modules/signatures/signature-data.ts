import { BadRequestException } from '@nestjs/common';
import { SignatureKind } from '@prisma/client';
import { z } from 'zod';
import { normalizeText } from '../moderation/moderation.service';
import { HEX_COLOR } from '../../render/color';
import {
  EMAIL_TEMPLATE_KEYS,
  emailSignatureDataSchema,
  type EmailSignatureData,
  type EmailTemplateKey,
} from '../../render/email-signature';
import {
  handwrittenDataSchema,
  stampDataSchema,
  findOfficialTerms,
  type HandwrittenData,
  type StampData,
} from '../../render/stamp';

export type SignatureData =
  | { kind: 'EMAIL'; data: EmailSignatureData }
  | { kind: 'HANDWRITTEN'; data: HandwrittenData }
  | { kind: 'STAMP'; data: StampData };

const SCHEMAS = {
  EMAIL: emailSignatureDataSchema,
  HANDWRITTEN: handwrittenDataSchema,
  STAMP: stampDataSchema,
} as const;

function invalid(error: z.ZodError, message: string): never {
  throw new BadRequestException({
    message,
    errors: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  });
}

/** Valide les champs d'une signature selon son type ; erreurs au format problem+json. */
export function parseSignatureData(kind: SignatureKind, raw: unknown): SignatureData {
  const parsed = SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) invalid(parsed.error, 'Données de signature invalides');
  return { kind, data: parsed.data } as SignatureData;
}

export function emailTemplateKey(key?: string | null): EmailTemplateKey {
  if (key === undefined || key === null) return 'classic';
  if (!(EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key)) {
    throw new BadRequestException(`Modèle de signature inconnu : ${key}`);
  }
  return key as EmailTemplateKey;
}

/** Marque fournie par le formulaire public (signature e-mail sans compte). */
export const publicBrandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slogan: z.string().trim().max(120).optional(),
  primary: z.string().regex(HEX_COLOR),
  secondary: z.string().regex(HEX_COLOR),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\//, 'URL HTTPS absolue attendue')
    .nullish(),
});

export function parsePublicBrand(raw: unknown) {
  const parsed = publicBrandSchema.safeParse(raw);
  if (!parsed.success) invalid(parsed.error, 'Marque invalide');
  return parsed.data;
}

export interface CsvMember {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
}

/** Lecture CSV simple (séparateur , ou ;, guillemets doubles), comme l'import du front. */
export function parseMembersCsv(source: string): CsvMember[] {
  const text = source.replace(/^\uFEFF/, '');
  const separator = (text.split('\n')[0] ?? '').includes(';') ? ';' : ',';
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (char === separator && !quoted) {
          cells.push(current.trim());
          current = '';
        } else current += char;
      }
      cells.push(current.trim());
      return cells;
    });
  const [header = [], ...data] = rows;
  const index = (...keys: string[]) =>
    header.findIndex((h) => keys.includes(h.toLowerCase().trim()));
  const cols = {
    name: index('nom', 'name', 'fullname'),
    title: index('fonction', 'title', 'poste'),
    email: index('email', 'e-mail'),
    phone: index('telephone', 'téléphone', 'phone'),
  };
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? '') : '');
  return data
    .map((cells) => ({
      fullName: cell(cells, cols.name).slice(0, 80),
      jobTitle: cell(cells, cols.title).slice(0, 80),
      email: cell(cells, cols.email).slice(0, 120),
      phone: cell(cells, cols.phone).slice(0, 30),
    }))
    .filter((r) => r.fullName);
}

/** Textes d'un cachet soumis au contrôle des termes officiels (§6.4). */
export function stampTerms(data: StampData) {
  return [data.ringText, data.bottomText, data.centerText];
}

/**
 * Termes qui soumettent un cachet à validation : liste noire STAMP puis termes officiels,
 * sans doublon à la casse et aux accents près.
 */
export function stampReviewTerms(data: StampData, blocked: string[]) {
  const seen = new Set<string>();
  return [...blocked, ...findOfficialTerms(...stampTerms(data))].filter((term) => {
    const key = normalizeText(term).trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
