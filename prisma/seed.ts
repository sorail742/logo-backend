/**
 * Données de départ (§12.1) : offres, liste noire, modèles.
 * Les prix en GNF sont provisoires (question ouverte §15.4) : 0 tant qu'ils ne sont pas fixés.
 * Idempotent : peut être relancé sans créer de doublons.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLANS = [
  {
    code: 'FREE',
    name: 'Gratuit',
    priceGnf: 0n,
    interval: null,
    monthlyCredits: 0,
    maxMembers: 1,
    features: { dailyNameBatches: 3, dailyLogoBatches: 1, maxPngSize: 512, watermark: true, emailSignatureBranding: true },
  },
  {
    code: 'PACK',
    name: 'Pack Identité',
    priceGnf: 0n,
    interval: null,
    monthlyCredits: 0,
    maxMembers: 1,
    features: { oneTimeCredits: 100, projects: 1, watermark: false, brandGuidePdf: true, stamp: true },
  },
  {
    code: 'ASSOCIATION',
    name: 'Association',
    priceGnf: 0n,
    interval: null,
    monthlyCredits: 0,
    maxMembers: 3,
    features: { oneTimeCredits: 100, projects: 1, watermark: false, brandGuidePdf: true, stamp: true, requiresProof: true },
  },
  {
    code: 'PRO',
    name: 'Pro',
    priceGnf: 0n,
    interval: 'month',
    monthlyCredits: 500,
    maxMembers: 5,
    features: { projects: 'unlimited', batchSignatures: true, watermark: false },
  },
  {
    code: 'AGENCY',
    name: 'Agence',
    priceGnf: 0n,
    interval: 'month',
    monthlyCredits: 2000,
    maxMembers: 15,
    features: { projects: 'unlimited', clientWorkspaces: 'unlimited', batchSignatures: true, watermark: false },
  },
];

/** Termes officiels bloqués sur les cachets (§6.4) et quelques termes injurieux (NOM-14). */
const BLOCKED_TERMS: { term: string; language: string; scope: string }[] = [
  ...['République', 'Ministère', 'Préfecture', 'Police', 'Gendarmerie', 'Tribunal', 'Présidence', 'Armée', 'Douane', 'Ambassade', 'Gouvernement', 'Mairie'].map(
    (term) => ({ term, language: 'fr', scope: 'STAMP' }),
  ),
  ...['Republic', 'Ministry', 'Police', 'Court', 'Army', 'Embassy', 'Government'].map((term) => ({
    term,
    language: 'en',
    scope: 'STAMP',
  })),
  ...['idiot', 'imbécile', 'connard', 'salope', 'pute', 'nazi', 'merde'].flatMap((term) => [
    { term, language: 'fr', scope: 'NAME' },
    { term, language: 'fr', scope: 'SLOGAN' },
  ]),
  ...['stupid', 'nazi', 'shit', 'bitch'].flatMap((term) => [
    { term, language: 'en', scope: 'NAME' },
    { term, language: 'en', scope: 'SLOGAN' },
  ]),
];

const TEMPLATES = [
  { kind: 'EMAIL_SIGNATURE', name: 'Classique', content: { layout: 'logo-left', divider: true } },
  { kind: 'EMAIL_SIGNATURE', name: 'Moderne', content: { layout: 'logo-top', accentBar: true } },
  { kind: 'EMAIL_SIGNATURE', name: 'Minimal', content: { layout: 'text-only' } },
  { kind: 'EMAIL_SIGNATURE', name: 'Institutionnel', content: { layout: 'logo-left', legalLine: true } },
  { kind: 'EMAIL_SIGNATURE', name: 'Compact', content: { layout: 'inline' } },
  { kind: 'EMAIL_SIGNATURE', name: 'Bannière', content: { layout: 'logo-left', banner: true } },
  { kind: 'STAMP', name: 'Rond', content: { shape: 'round' } },
  { kind: 'STAMP', name: 'Ovale', content: { shape: 'oval' } },
  { kind: 'STAMP', name: 'Rectangulaire', content: { shape: 'rect' } },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
  }

  await prisma.blockedTerm.createMany({ data: BLOCKED_TERMS, skipDuplicates: true });

  for (const t of TEMPLATES) {
    const existing = await prisma.template.findFirst({ where: { kind: t.kind, name: t.name } });
    if (!existing) await prisma.template.create({ data: t });
  }

  console.log(`Seed : ${PLANS.length} offres, ${BLOCKED_TERMS.length} termes bloqués, ${TEMPLATES.length} modèles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
