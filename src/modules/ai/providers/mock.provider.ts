import { Injectable } from '@nestjs/common';
import { NameStyle } from '@prisma/client';
import { paletteFromList, STYLE_PALETTES, type LogoStyle } from '../../../render/color';
import { FONTS } from '../../../render/fonts';
import { ICONS, searchIcons } from '../../../render/icons';
import type { IconFrame } from '../../../render/logo-spec';
import { hashSeed, renderArtwork, styleFromPrompt } from '../../../render/artwork';
import { svgToPng } from '../../../render/raster';
import type {
  GeneratedName,
  ImageGenerationInput,
  LogoComposition,
  LogoGenerationInput,
  NameGenerationInput,
  SloganGenerationInput,
} from '../../../shared/ai-schemas';
import { AiCallResult, AiImagesResult, AiProvider } from '../ai-provider';

/** Taille des images produites (côté le plus long, en px). */
const IMAGE_SIZE = 1600;
const ASPECT_RATIOS = { square: 1, portrait: 4 / 5, landscape: 16 / 9 } as const;

const SUFFIXES = ['ia', 'o', 'ya', 'ka', 'is', 'en', 'ora', 'ix', 'ari', 'ly'];
const PREFIXES = ['Néo', 'Nova', 'Ka', 'Sira', 'Bara', 'Lumi', 'Teri', 'Dia', 'Fala', 'Woni'];
const METAPHORS = ['Baobab', 'Horizon', 'Étoile', 'Source', 'Racine', 'Pont', 'Flamme', 'Envol'];

/** Gabarits de slogans par langue et par ton (même base que le simulateur du front). */
const SLOGAN_TEMPLATES: Record<'fr' | 'en', Record<SloganGenerationInput['tone'], string[]>> = {
  fr: {
    INSPIRING: ['Ensemble, faisons grandir {value}', "{Value}, aujourd'hui pour demain", "Semer {value}, récolter l'avenir", 'Chaque geste compte', 'Plus loin, ensemble'],
    INSTITUTIONAL: ['Au service de {value}', "L'engagement au cœur de {sector}", 'La référence en {sector}', 'Agir avec rigueur et {value}', 'Votre partenaire de confiance'],
    CATCHY: ['{Name}, et ça change tout', 'Simple. Rapide. {Name}.', 'Le {sector} autrement', 'Osez {value}', "{Name}, c'est maintenant"],
    ENGAGED: ['Agir pour {value}, maintenant', 'Notre force : {value}', 'Pour une Guinée plus {value}', 'Debout pour {value}', 'Changer les choses, ensemble'],
  },
  en: {
    INSPIRING: ['Growing {value} together', '{Value} today, for tomorrow', 'Every step counts', 'Further, together'],
    INSTITUTIONAL: ['Serving {value}', 'Trusted in {sector}', 'Commitment at the heart of {sector}'],
    CATCHY: ['{Name}. That changes everything.', 'Simple. Fast. {Name}.', '{sector}, reinvented'],
    ENGAGED: ['Acting for {value}, now', 'Standing up for {value}', 'Change starts with us'],
  },
};

/** Polices de la bibliothèque associées à chaque style de logo (LOGO-02). */
const STYLE_FONTS: Record<LogoStyle, string[]> = {
  MINIMAL: [
    'space-grotesk',
    'inter',
    'manrope',
    'dm-sans',
    'outfit',
    'raleway',
    'work-sans',
  ],
  MODERN: [
    'poppins',
    'plus-jakarta-sans',
    'outfit',
    'syne',
    'unbounded',
    'bricolage-grotesque',
    'montserrat',
    'rubik',
  ],
  CLASSIC: [
    'playfair',
    'fraunces',
    'dm-serif-display',
    'cormorant-garamond',
    'libre-baskerville',
    'lora',
    'merriweather',
  ],
  INSTITUTIONAL: [
    'merriweather',
    'roboto-slab',
    'libre-baskerville',
    'montserrat',
    'archivo',
    'work-sans',
    'lora',
  ],
  PLAYFUL: [
    'nunito',
    'righteous',
    'comfortaa',
    'quicksand',
    'lobster',
    'rubik',
    'bebas-neue',
  ],
  AFRICAN: [
    'oswald',
    'anton',
    'bebas-neue',
    'alfa-slab-one',
    'abril-fatface',
    'teko',
    'barlow-condensed',
    'archivo-black',
  ],
};

/**
 * Fournisseur factice déterministe, utilisé en développement et en test tant que le
 * fournisseur IA réel n'est pas choisi (§15.4). Produit des noms plausibles à partir du brief.
 */
@Injectable()
export class MockAiProvider extends AiProvider {
  readonly name = 'mock';

  async generateNames(input: NameGenerationInput): Promise<AiCallResult> {
    const { brief } = input;
    const words = [...brief.mustInclude, ...brief.values, brief.sector, ...brief.mission.split(/\s+/)]
      .map(clean)
      .filter((w) => w.length >= 3);
    const roots = [...new Set(words.map((w) => cap(w.slice(0, Math.min(5, w.length)))))];
    if (roots.length === 0) roots.push('Kalo');

    const styles = brief.nameStyles.length ? brief.nameStyles : [NameStyle.INVENTED, NameStyle.COMPOUND];
    const seed = hash(JSON.stringify(input));
    const exclude = new Set(input.exclude.map((n) => n.toLowerCase()));
    const maxLen = brief.maxLength ?? (input.feedback?.includes('court') ? 7 : 14);

    const names: GeneratedName[] = [];
    for (let i = 0; names.length < input.count && i < input.count * 8; i++) {
      const style = styles[i % styles.length];
      const root = roots[(seed + i) % roots.length];
      const candidate = this.build(style, root, roots, seed + i, input);
      if (!candidate || candidate.value.length > maxLen) continue;
      if (exclude.has(candidate.value.toLowerCase())) continue;
      exclude.add(candidate.value.toLowerCase());
      names.push(candidate);
    }

    return { raw: { names }, provider: this.name, promptVersion: 'mock-1', costUsdMicros: 0 };
  }

  /** Port du simulateur du front : icônes liées au brief, polices et palettes selon le style. */
  async composeLogos(input: LogoGenerationInput): Promise<AiCallResult> {
    const random = rng(hash(JSON.stringify(input)));
    const pick = <T>(arr: readonly T[]) => arr[Math.floor(random() * arr.length)];
    const feedback = (input.feedback ?? '').toLowerCase();
    const reference = input.reference;
    const sameColors = /m[êe]mes? couleurs|same colou?rs/.test(feedback) && !!reference;
    const otherIcon = /autre ic[ôo]ne|other icon/.test(feedback);
    const simpler = /simple/.test(feedback);

    // Icônes dont les étiquettes rejoignent le brief, complétées au hasard.
    const terms = [...(input.brief?.values ?? []), input.brief?.sector ?? '', ...(input.brief?.mustInclude ?? [])];
    const avoided = otherIcon ? reference?.iconId : undefined;
    const icons = [...new Set(terms.flatMap((t) => searchIcons(t.slice(0, 6)).map((i) => i.id)))].filter(
      (id) => id !== avoided,
    );
    while (icons.length < input.count) {
      const id = pick(ICONS).id;
      if (!icons.includes(id) && id !== avoided) icons.push(id);
    }

    const fonts = STYLE_FONTS[input.style].filter((id) => FONTS.some((f) => f.id === id));
    const frames: IconFrame[] = simpler ? ['none'] : ['circle', 'rounded', 'none', 'hexagon'];
    const compositions: LogoComposition[] = [];
    for (let i = 0; i < input.count; i++) {
      const colors = sameColors
        ? reference!.colors
        : input.palette
          ? paletteFromList(input.palette)
          : { ...pick(STYLE_PALETTES[input.style]) };
      const keepIcon = reference?.iconId && !otherIcon;
      compositions.push({
        iconId: input.type === 'MONOGRAM' ? null : keepIcon ? reference.iconId : icons[i % icons.length],
        fontId: pick(fonts.length ? fonts : ['montserrat']),
        fontWeight: pick([600, 700, 800]),
        letterSpacing: input.style === 'MINIMAL' || input.style === 'INSTITUTIONAL' ? 0.04 : pick([0, 0, 0.02, 0.08]),
        uppercase: input.style === 'INSTITUTIONAL' || input.style === 'AFRICAN' || random() > 0.7,
        iconFrame: input.type === 'MONOGRAM' ? pick(['circle', 'rounded', 'hexagon'] as const) : pick(frames),
        layout: input.type === 'WORDMARK' ? 'text' : i % 3 === 2 ? 'vertical' : 'horizontal',
        colors,
        withTagline: !simpler && random() > 0.5,
        rationale: `Style ${input.style.toLowerCase()}, proposition ${i + 1}`,
      });
    }

    return { raw: { compositions }, provider: this.name, promptVersion: 'mock-logos-1', costUsdMicros: 0 };
  }

  /** Port du simulateur du front : gabarits par ton, devises en trois termes, phrases de mission. */
  async generateSlogans(input: SloganGenerationInput): Promise<AiCallResult> {
    const random = rng(hash(JSON.stringify(input)));
    const pick = <T>(arr: readonly T[]) => arr[Math.floor(random() * arr.length)];
    const values = input.brief?.values.length ? input.brief.values : ['progrès', 'unité', 'travail'];
    const exclude = new Set(input.exclude.map((t) => t.toLowerCase()));
    const texts = new Set<string>();

    if (input.kind === 'DEVISE') {
      const pool = [...values, 'Unité', 'Travail', 'Progrès', 'Solidarité', 'Justice', 'Engagement', 'Excellence'];
      for (let guard = 0; texts.size < Math.min(input.count, 6) && guard < 200; guard++) {
        const terms = new Set<string>();
        while (terms.size < 3) terms.add(cap(pick(pool)));
        const devise = [...terms].join(' – ');
        if (!exclude.has(devise.toLowerCase())) texts.add(devise);
      }
    } else if (input.kind === 'MISSION') {
      const mission = input.brief?.mission || `accompagner ${input.brief?.audience || 'notre communauté'}`;
      const audience = input.brief?.audience || 'celles et ceux';
      [
        `${input.name} a pour mission de ${mission.charAt(0).toLowerCase()}${mission.slice(1).replace(/\.$/, '')}.`,
        `Nous rassemblons ${audience} qui partagent nos valeurs : ${values.join(', ')}.`,
        `${input.name} agit au quotidien pour ${values[0]} et ${values[1] ?? 'le progrès'}.`,
      ]
        .filter((t) => !exclude.has(t.toLowerCase()))
        .forEach((t) => texts.add(t));
    } else {
      const tones = Object.keys(SLOGAN_TEMPLATES[input.language]) as SloganGenerationInput['tone'][];
      for (let guard = 0; texts.size < input.count && guard < 300; guard++) {
        const templates = [...SLOGAN_TEMPLATES[input.language][input.tone], ...SLOGAN_TEMPLATES[input.language][pick(tones)]];
        const value = pick(values);
        const text = pick(templates)
          .replace('{value}', value.toLowerCase())
          .replace('{Value}', cap(value))
          .replace('{Name}', input.name)
          .replace('{sector}', (input.brief?.sector || 'service').toLowerCase());
        if (text.split(/\s+/).length > input.maxWords || exclude.has(text.toLowerCase())) continue;
        texts.add(text);
      }
    }

    const slogans = [...texts].map((text) => ({ text }));
    return { raw: { slogans }, provider: this.name, promptVersion: 'mock-slogans-1', costUsdMicros: 0 };
  }

  private build(
    style: NameStyle,
    root: string,
    roots: string[],
    n: number,
    input: NameGenerationInput,
  ): GeneratedName | null {
    const pick = <T>(arr: T[]) => arr[n % arr.length];
    switch (style) {
      case NameStyle.INVENTED: {
        const value = cap(root.slice(0, 4).toLowerCase() + pick(SUFFIXES));
        return { value, meaning: `Nom inventé à partir de « ${root.toLowerCase()} »`, style, pronunciation: value.toLowerCase() };
      }
      case NameStyle.COMPOUND: {
        const value = `${pick(PREFIXES)}${root.toLowerCase()}`;
        return { value, meaning: `Composé de « ${pick(PREFIXES)} » et « ${root.toLowerCase()} »`, style };
      }
      case NameStyle.METAPHORICAL: {
        const value = pick(METAPHORS);
        return { value: `${value} ${root}`, meaning: `Image de « ${value.toLowerCase()} » appliquée au projet`, style };
      }
      case NameStyle.DESCRIPTIVE: {
        const sector = cap(clean(input.brief.sector)) || root;
        return { value: `${sector} ${pick(['Plus', 'Action', 'Avenir', 'Solidaire', 'Connect'])}`, meaning: `Décrit directement l'activité : ${input.brief.sector}`, style };
      }
      case NameStyle.ACRONYM: {
        const words = [pick(['Association', 'Alliance', 'Collectif', 'Réseau']), 'pour', ...roots.slice(0, 3)];
        const acronym = words.filter((w) => w.length > 3).map((w) => w[0].toUpperCase()).join('');
        if (acronym.length < 2) return null;
        return { value: acronym, acronym, expandedForm: words.join(' '), meaning: `Sigle de « ${words.join(' ')} »`, style };
      }
      case NameStyle.PROPER: {
        const value = pick(['Maison', 'Atelier', 'Studio', 'Cercle']) + ' ' + pick(['Kadia', 'Fanta', 'Sékou', 'Mariama', 'Alpha']);
        return { value, meaning: 'Nom propre évocateur, chaleureux et personnel', style };
      }
      default:
        return null;
    }
  }

  /**
   * Images de démonstration : visuels génératifs vectoriels (style choisi, ou suggéré par un mot
   * de la description), aux couleurs demandées, puis tramés. Un fournisseur réel remplacera
   * cette méthode sans changer le reste.
   */
  generateImages(input: ImageGenerationInput): Promise<AiImagesResult> {
    const ratio = ASPECT_RATIOS[input.aspect];
    const width = ratio >= 1 ? IMAGE_SIZE : Math.round(IMAGE_SIZE * ratio);
    const height = ratio >= 1 ? Math.round(IMAGE_SIZE / ratio) : IMAGE_SIZE;
    const style =
      input.style === 'auto' ? (styleFromPrompt(input.prompt) ?? 'abstract') : input.style;
    const seed = hashSeed(`${input.prompt}|${input.style}|${input.palette.join()}`);
    const images = Array.from({ length: input.count }, (_, i) => {
      const svg = renderArtwork({ style, palette: input.palette, width, height, seed: seed + i * 7919 });
      return { data: svgToPng(svg, { size: Math.max(width, height) }), width, height };
    });
    return Promise.resolve({ images, provider: this.name, promptVersion: 'artwork-v1', costUsdMicros: 0, demo: true });
  }
}

function clean(w: string) {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '');
}

function cap(w: string) {
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
