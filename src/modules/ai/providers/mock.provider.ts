import { Injectable } from '@nestjs/common';
import { NameStyle } from '@prisma/client';
import type { GeneratedName, NameGenerationInput } from '../../../shared/ai-schemas';
import { AiCallResult, AiProvider } from '../ai-provider';

const SUFFIXES = ['ia', 'o', 'ya', 'ka', 'is', 'en', 'ora', 'ix', 'ari', 'ly'];
const PREFIXES = ['Néo', 'Nova', 'Ka', 'Sira', 'Bara', 'Lumi', 'Teri', 'Dia', 'Fala', 'Woni'];
const METAPHORS = ['Baobab', 'Horizon', 'Étoile', 'Source', 'Racine', 'Pont', 'Flamme', 'Envol'];

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
}

function clean(w: string) {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '');
}

function cap(w: string) {
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
