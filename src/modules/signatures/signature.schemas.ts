import { z } from 'zod';
import { FONTS } from '../../render/assets';
import { SOCIAL_NETWORKS } from '../../render/signatures/email';
import { HANDWRITING_FONTS, INK_COLORS } from '../../render/signatures/handwritten';
import { STAMP_SHAPES } from '../../render/signatures/stamp';

const inkColor = z.enum(
  Object.keys(INK_COLORS) as [keyof typeof INK_COLORS, ...(keyof typeof INK_COLORS)[]],
);

/** Champs de la signature e-mail (SIG-10, SIG-11, SIG-17). */
export const emailDataSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  jobTitle: z.string().trim().max(80).nullish(),
  organization: z.string().trim().max(120).nullish(),
  phones: z
    .array(z.string().regex(/^\+\d{8,15}$/, 'Téléphone au format international, ex. +224620000000'))
    .max(3)
    .default([]),
  email: z.string().email().max(160).nullish(),
  website: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(200).nullish(),
  socials: z.record(z.enum(SOCIAL_NETWORKS), z.string().trim().max(300)).default({}),
  legalNotice: z.string().trim().max(400).nullish(),
  banner: z
    .object({ text: z.string().trim().min(2).max(80), url: z.string().trim().max(300) })
    .nullish(),
});
export type EmailData = z.infer<typeof emailDataSchema>;

const handwritingFontIds = HANDWRITING_FONTS.map((f) => f.id) as [string, ...string[]];

/** Paraphe généré (SIG-20) ou dessiné (SIG-21). */
export const handwrittenDataSchema = z.object({
  ink: inkColor.default('blue'),
  spec: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('generated'),
      text: z.string().trim().min(1).max(60),
      fontId: z.enum(handwritingFontIds),
      weight: z.number().int().default(400),
      flourish: z.boolean().default(false),
      slant: z.number().min(-20).max(20).default(-4),
    }),
    z.object({
      mode: z.literal('drawn'),
      strokes: z
        .array(
          z
            .array(z.tuple([z.number().finite(), z.number().finite()]))
            .min(1)
            .max(5000),
        )
        .min(1)
        .max(60),
    }),
  ]),
});
export type HandwrittenData = z.infer<typeof handwrittenDataSchema>;

const stampFontIds = FONTS.filter((f) => f.category !== 'script').map((f) => f.id) as [
  string,
  ...string[],
];

/** Cachet (SIG-22, SIG-23). */
export const stampDataSchema = z.object({
  shape: z.enum(STAMP_SHAPES),
  topText: z.string().trim().min(2).max(60),
  bottomText: z.string().trim().max(60).nullish(),
  center: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('acronym'), text: z.string().trim().min(1).max(8) }),
    z.object({ kind: z.literal('icon'), iconId: z.string().min(1) }),
    z.object({ kind: z.literal('none') }),
  ]),
  title: z.string().trim().max(40).nullish(),
  ink: inkColor.default('blue'),
  inkEffect: z.boolean().default(false),
  fontId: z.enum(stampFontIds).default('roboto-slab'),
});
export type StampData = z.infer<typeof stampDataSchema>;

/** Rappel affiché avant tout export d'un paraphe ou d'un cachet (§6.4). */
export const IMAGE_SIGNATURE_NOTICE =
  'Ce paraphe ou ce cachet est une image : il n’a pas la valeur d’une signature électronique qualifiée.';
