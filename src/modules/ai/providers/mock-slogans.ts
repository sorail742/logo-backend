import type { SloganGenerationInput } from '../../../shared/ai-schemas';

/** Gabarits de slogans par ton ; {N} = nom, {V} = valeur, {S} = secteur, {A} = public. */
const PATTERNS: Record<SloganGenerationInput['tone'], { fr: string[]; en: string[] }> = {
  INSPIRING: {
    fr: [
      'Ensemble, faisons grandir {V}',
      'Chaque pas compte pour {A}',
      'Semer {V}, récolter demain',
      '{N}, l’élan qui nous rassemble',
      'Oser {V}, construire l’avenir',
      'Donner des ailes à {A}',
      'Là où {V} prend racine',
      'Le futur commence avec {V}',
      'Grandir ensemble, rêver plus loin',
      'Avec {A}, pour demain',
      'Chaque idée mérite de grandir',
      'Allumer l’envie d’avancer',
    ],
    en: [
      'Together, we grow {V}',
      'Every step counts for {A}',
      'Where {V} takes root',
      'Daring {V}, building tomorrow',
      'Growing together, dreaming further',
      'With {A}, for tomorrow',
      'Every idea deserves to grow',
      'Lighting the way forward',
      '{N}, the spark that unites us',
      'Tomorrow starts with {V}',
    ],
  },
  INSTITUTIONAL: {
    fr: [
      '{N}, au service de {A}',
      'Agir avec {V}, servir avec rigueur',
      'L’engagement durable pour {S}',
      'Une référence en {S}',
      'La confiance au cœur de {S}',
      '{V} et exigence, chaque jour',
      'Servir {A} avec exigence',
      '{N} : rigueur et proximité',
      'Bâtir durablement avec {A}',
      'La qualité au service de {A}',
      'Un partenaire de confiance',
      'L’excellence, notre engagement',
    ],
    en: [
      '{N}, serving {A}',
      'Committed to {S}',
      'Trust at the heart of {S}',
      'Serving {A} with care',
      '{N}: rigour and proximity',
      'Building lasting value',
      'Quality in service of {A}',
      'A partner you can trust',
      'Excellence is our commitment',
      'Integrity, every day',
    ],
  },
  CATCHY: {
    fr: [
      '{N}, et ça change tout',
      'Le bon réflexe {S}',
      'Simple. Rapide. {N}.',
      '{V}, version {N}',
      'Vous allez adorer {V}',
      'Plus de {V}, moins de soucis',
      'Ça change tout pour {A}',
      'Essayez, vous verrez',
      '{N}, tout simplement',
      'Le réflexe qui rassemble',
      'Plus simple avec {N}',
      'On s’en occupe',
    ],
    en: [
      '{N}, and everything changes',
      'Simple. Fast. {N}.',
      'More {V}, less hassle',
      'Try it, you’ll see',
      '{N}, simply',
      'Easier with {N}',
      'We’ve got this',
      'The go-to for {A}',
      'Love {V} again',
      'Made for {A}',
    ],
  },
  COMMITTED: {
    fr: [
      'Debout pour {A}',
      'Agir aujourd’hui pour {V}',
      'Nos voix pour {V}',
      'Ne rien lâcher sur {V}',
      'Changer les choses, ensemble',
      'Pour {A}, avec {A}',
      'Agir ici, changer demain',
      'Notre combat : {V}',
      'Ensemble pour {V}',
      'La voix de {A}',
      'Mobilisés pour {S}',
      'Chaque geste compte',
    ],
    en: [
      'Standing up for {A}',
      'Acting today for {V}',
      'Never giving up on {V}',
      'Act here, change tomorrow',
      'Our fight: {V}',
      'Together for {V}',
      'The voice of {A}',
      'Mobilised for {S}',
      'Every action counts',
      'For {A}, with {A}',
    ],
  },
};

const MOTTO_TERMS = [
  'Unité',
  'Travail',
  'Solidarité',
  'Progrès',
  'Engagement',
  'Respect',
  'Excellence',
  'Partage',
  'Paix',
  'Courage',
];

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Slogans factices déterministes, respectant la longueur maximale. */
export function mockSlogans(input: SloganGenerationInput) {
  const patterns = PATTERNS[input.tone][input.language];
  const values = input.brief.values.length ? input.brief.values : ['la solidarité'];
  const audience = input.brief.audience || (input.language === 'fr' ? 'tous' : 'everyone');
  const sector =
    input.brief.sector.toLowerCase() || (input.language === 'fr' ? 'notre domaine' : 'our field');
  const exclude = new Set(input.exclude.map((e) => e.toLowerCase()));
  const shorter = /court|short/i.test(input.feedback ?? '');
  const maxWords = shorter ? Math.max(2, input.maxWords - 2) : input.maxWords;

  const slogans: { text: string; kind: 'SLOGAN' | 'DEVISE' | 'MISSION' }[] = [];
  for (let i = 0; slogans.length < input.count && i < patterns.length * values.length * 2; i++) {
    const text = cap(
      patterns[i % patterns.length]
        .replace(/\{N\}/g, input.name)
        .replace(/\{V\}/g, values[Math.floor(i / patterns.length) % values.length].toLowerCase())
        .replace(/\{S\}/g, sector)
        .replace(/\{A\}/g, audience),
    );
    if (text.split(/\s+/).length > maxWords || exclude.has(text.toLowerCase())) continue;
    if (slogans.some((s) => s.text === text)) continue;
    slogans.push({ text, kind: 'SLOGAN' });
  }

  if (input.withMotto) {
    const fromValues = input.brief.values.map((v) => cap(v.trim())).filter((v) => !v.includes(' '));
    const terms = [...new Set([...fromValues, ...MOTTO_TERMS])];
    for (let k = 0; k < 3; k++) {
      slogans.push({
        text: [
          terms[k % terms.length],
          terms[(k + 1) % terms.length],
          terms[(k + 3) % terms.length],
        ].join(' – '),
        kind: 'DEVISE',
      });
    }
    slogans.push({
      text: `${input.name} a pour mission de ${input.brief.mission.replace(/\.$/, '').toLowerCase() || 'servir ses membres'}.`,
      kind: 'MISSION',
    });
  }
  return slogans;
}
