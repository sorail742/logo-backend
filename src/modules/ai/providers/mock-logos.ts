import { FONTS, iconExists, searchIcons } from '../../../render/assets';
import type { LogoGenerationInput, LogoSpecInput } from '../../../shared/logo-spec';

/** Mots du brief (français) vers les étiquettes anglaises de la bibliothèque d'icônes. */
const FR_KEYWORDS: Record<string, string[]> = {
  education: ['school', 'book'],
  ecole: ['school'],
  formation: ['school', 'certificate'],
  etudiant: ['school'],
  jeunesse: ['users', 'mood-happy'],
  jeune: ['users'],
  enfant: ['baby-carriage', 'mood-kid'],
  famille: ['users-group'],
  sante: ['heart', 'stethoscope'],
  medical: ['stethoscope', 'first-aid-kit'],
  soin: ['heart'],
  solidarite: ['heart-handshake'],
  entraide: ['heart-handshake'],
  association: ['users-group'],
  communaute: ['users-group'],
  agriculture: ['plant', 'leaf'],
  agricole: ['plant'],
  ferme: ['tractor'],
  environnement: ['leaf', 'trees'],
  ecologie: ['leaf', 'recycle'],
  nature: ['leaf', 'tree'],
  eau: ['droplet'],
  energie: ['bolt', 'solar-panel'],
  technologie: ['cpu', 'code'],
  numerique: ['device-laptop', 'code'],
  application: ['device-mobile'],
  logiciel: ['code'],
  finance: ['coin', 'chart-line'],
  paiement: ['credit-card', 'wallet'],
  banque: ['building-bank'],
  argent: ['coin'],
  commerce: ['shopping-cart', 'building-store'],
  marche: ['building-store'],
  transport: ['truck', 'bus'],
  voyage: ['plane'],
  sport: ['ball-football', 'trophy'],
  football: ['ball-football'],
  basket: ['ball-basketball'],
  musique: ['music'],
  culture: ['palette', 'masks-theater'],
  art: ['palette', 'brush'],
  femme: ['woman', 'gender-female'],
  femmes: ['woman'],
  avenir: ['rocket', 'sunrise'],
  innovation: ['bulb', 'rocket'],
  emploi: ['briefcase'],
  entreprise: ['building', 'briefcase'],
  evenement: ['calendar-event', 'confetti'],
  festival: ['confetti'],
  cuisine: ['chef-hat'],
  restaurant: ['tools-kitchen-2'],
  construction: ['building', 'crane'],
  immobilier: ['home'],
  maison: ['home'],
  securite: ['shield-check'],
  justice: ['scale'],
  communication: ['speakerphone', 'message'],
  media: ['microphone', 'news'],
  paix: ['dove'],
  droits: ['scale'],
};

const ENTITY_ICONS: Record<string, string[]> = {
  ASSOCIATION: ['heart-handshake', 'users-group', 'hand-love-you'],
  APPLICATION: ['device-mobile', 'apps', 'bolt'],
  PLATFORM: ['world', 'stack-2', 'network'],
  COMPANY: ['building', 'briefcase', 'chart-arrows-vertical'],
  EVENT: ['calendar-event', 'confetti', 'star'],
  OTHER: ['star', 'sparkles', 'circle-dot'],
};

const STYLE_PALETTES: Record<LogoGenerationInput['style'], string[][]> = {
  MINIMALIST: [
    ['#111827', '#6B7280'],
    ['#0F172A', '#38BDF8'],
    ['#1F2937', '#10B981'],
  ],
  MODERN: [
    ['#2563EB', '#7C3AED'],
    ['#0EA5E9', '#1E293B'],
    ['#7C3AED', '#F43F5E'],
  ],
  CLASSIC: [
    ['#7C2D12', '#B45309'],
    ['#1E3A8A', '#A16207'],
    ['#14532D', '#A16207'],
  ],
  INSTITUTIONAL: [
    ['#1E3A8A', '#B91C1C'],
    ['#0F766E', '#1E293B'],
    ['#1D4ED8', '#CA8A04'],
  ],
  PLAYFUL: [
    ['#F97316', '#14B8A6'],
    ['#EC4899', '#8B5CF6'],
    ['#22C55E', '#F59E0B'],
  ],
  AFRICAN: [
    ['#B45309', '#15803D'],
    ['#C2410C', '#FACC15'],
    ['#166534', '#B91C1C'],
  ],
};

const CONTAINERS = ['circle', 'rounded', 'none', 'hexagon'] as const;
const SHAPES = ['circle', 'shield', 'badge'] as const;

function normalize(w: string) {
  return w
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Icônes candidates, des plus pertinentes aux plus génériques. */
function candidateIcons(input: LogoGenerationInput): string[] {
  const words = [
    input.brief.sector,
    ...input.brief.values,
    ...input.brief.mission.split(/\s+/),
    input.text,
  ]
    .flatMap((w) => w.split(/[\s,;'’-]+/))
    .map(normalize)
    .filter((w) => w.length >= 3);
  const out: string[] = [];
  for (const w of words) {
    out.push(...(FR_KEYWORDS[w] ?? []));
    out.push(...searchIcons(w, 2).map((i) => i.id));
  }
  out.push(...(ENTITY_ICONS[input.entityType] ?? ENTITY_ICONS.OTHER));
  const avoid = new Set(input.avoidIcons);
  const unique = [...new Set(out)].filter((id) => iconExists(id));
  const fresh = unique.filter((id) => !avoid.has(id));
  return fresh.length >= 3 ? fresh : unique;
}

/** Composition factice déterministe : variété de types, polices, icônes et palettes. */
export function mockComposeLogos(input: LogoGenerationInput, count: number): LogoSpecInput[] {
  const fb = (input.feedback ?? '').toLowerCase();
  const simpler = /simple|sobre|minimal/.test(fb);
  const sameColors = /m[eê]mes? couleurs|garder.*couleur/.test(fb) && input.reference;
  const otherIcon = /autre ic[oô]ne/.test(fb);

  const fonts = FONTS.filter((f) => f.styles.includes(input.style) && f.category !== 'script');
  const fontPool = fonts.length ? fonts : FONTS;
  const palettes = input.palette ? [input.palette] : STYLE_PALETTES[input.style];
  let icons = candidateIcons(input);
  if (otherIcon && input.reference?.icon)
    icons = icons.filter((i) => i !== input.reference!.icon!.id);
  const hasAcronym = !!input.acronym && input.acronym.length <= 4;

  const specs: LogoSpecInput[] = [];
  for (let i = 0; i < count; i++) {
    const type = input.types[i % input.types.length];
    const font = fontPool[(i * 3) % fontPool.length];
    const palette = sameColors
      ? [
          input.reference!.colors.primary,
          input.reference!.colors.secondary ?? input.reference!.colors.text,
        ]
      : palettes[i % palettes.length];
    const primary = palette[0];
    const secondary = palette[1] ?? palette[0];
    const icon = icons[i % icons.length];
    const display = font.category === 'display';

    specs.push({
      type,
      layout: type === 'WORDMARK' ? 'text' : i % 3 === 2 ? 'vertical' : 'horizontal',
      text: input.text,
      acronym: hasAcronym ? input.acronym : null,
      tagline: input.tagline ?? null,
      font: {
        id: font.id,
        weight: font.weights.includes(700) ? 700 : font.weights[font.weights.length - 1],
      },
      letterSpacing: display ? 0.06 : type === 'WORDMARK' ? 0.02 : 0,
      uppercase: display || (type === 'WORDMARK' && i % 2 === 1),
      colors: {
        primary,
        secondary,
        text: type === 'WORDMARK' ? primary : '#1F2937',
        background: null,
      },
      icon:
        type === 'WORDMARK'
          ? null
          : {
              id: icon,
              container: simpler ? 'none' : CONTAINERS[i % CONTAINERS.length],
              scale: 1.4,
            },
      emblem: type === 'EMBLEM' ? { shape: SHAPES[i % SHAPES.length] } : null,
    });
  }
  return specs;
}
