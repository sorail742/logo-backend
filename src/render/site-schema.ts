import { z } from 'zod';
import { HEX_COLOR } from './color';
import { isLibraryFont } from './fonts';
import { MOCKUP_SCENES } from './mockups';
import { SITE_SOCIALS, SITE_THEMES, type SiteContent } from './site';

// Contenu d'un site reçu de l'éditeur : chaque champ borné, une section de chaque type au plus.

const text = (max: number) => z.string().trim().max(max);
const color = z.string().regex(HEX_COLOR);
const font = z.object({
  id: z.string().refine(isLibraryFont, 'Police hors bibliothèque'),
  weight: z.number().int().min(100).max(900),
});
const sceneIds = MOCKUP_SCENES.map((s) => s.id) as [string, ...string[]];
const image = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('media'), id: z.string().uuid(), alt: text(160) }),
  z.object({ kind: z.literal('mockup'), scene: z.enum(sceneIds) }),
]);
const base = { visible: z.boolean(), title: text(120) };

const section = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hero'),
    ...base,
    subtitle: text(240),
    cta: text(40),
    ctaTarget: z.enum(['contact', 'whatsapp', 'services']),
    image: image.nullable(),
  }),
  z.object({
    type: z.literal('about'),
    ...base,
    text: text(3000),
    values: z.array(text(60)).max(8),
  }),
  z.object({
    type: z.literal('services'),
    ...base,
    intro: text(400),
    items: z
      .array(
        z.object({ title: text(80), text: text(400), icon: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
      )
      .max(12),
  }),
  z.object({ type: z.literal('gallery'), ...base, images: z.array(image).max(16) }),
  z.object({
    type: z.literal('testimonials'),
    ...base,
    items: z.array(z.object({ quote: text(600), author: text(80), role: text(80) })).max(12),
  }),
  z.object({
    type: z.literal('faq'),
    ...base,
    items: z.array(z.object({ question: text(200), answer: text(1200) })).max(16),
  }),
  z.object({ type: z.literal('contact'), ...base, text: text(400), form: z.boolean() }),
]);

export const siteContentSchema = z.object({
  language: z.enum(['fr', 'en']),
  theme: z.enum(SITE_THEMES as unknown as [string, ...string[]]),
  colors: z.object({ primary: color, secondary: color, text: color, background: color }),
  fonts: z.object({ heading: font, body: font }),
  sections: z
    .array(section)
    .max(7)
    .refine((list) => new Set(list.map((s) => s.type)).size === list.length, {
      message: 'Une seule section de chaque type',
    }),
  contact: z.object({
    phone: text(40),
    whatsapp: text(40),
    email: z.union([z.literal(''), z.string().trim().email().max(200)]),
    address: text(300),
    hours: text(300),
  }),
  social: z.object(
    Object.fromEntries(SITE_SOCIALS.map((key) => [key, text(300).optional()])) as Record<
      (typeof SITE_SOCIALS)[number],
      z.ZodOptional<z.ZodString>
    >,
  ),
  seo: z.object({ title: text(120), description: text(300) }),
  credit: z.boolean(),
});

export function parseSiteContent(raw: unknown) {
  return siteContentSchema.safeParse(raw) as z.SafeParseReturnType<unknown, SiteContent>;
}

/** Adresse publique : lettres minuscules, chiffres et tirets (3 à 48 caractères). */
export const SITE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
