import type {
  ImageGenerationInput,
  LogoGenerationInput,
  NameGenerationInput,
  SloganGenerationInput,
} from '../../shared/ai-schemas';

export interface AiCallResult {
  /** Réponse brute, non fiable : à valider par schéma zod avant usage. */
  raw: unknown;
  provider: string;
  promptVersion: string;
  costUsdMicros: number;
}

/** Images produites (PNG), avec leur taille. */
export interface AiImagesResult {
  images: { data: Buffer; width: number; height: number }[];
  provider: string;
  promptVersion: string;
  costUsdMicros: number;
  /** Fournisseur de démonstration : visuels génératifs, la description n'est pas interprétée. */
  demo: boolean;
}

/**
 * Abstraction des fournisseurs IA (NOM-10, §11.1) : le reste du code ne dépend que de cette interface.
 * Règle §14.1 : le brief est transmis comme donnée, jamais concaténé comme instruction.
 */
export abstract class AiProvider {
  abstract readonly name: string;
  /** Fournisseur de démonstration : propositions simulées, sans modèle génératif. */
  abstract readonly demo: boolean;
  abstract generateNames(input: NameGenerationInput): Promise<AiCallResult>;
  /** Moteur A (§5.1) : choix d'icône, de police, de palette et de disposition par proposition. */
  abstract composeLogos(input: LogoGenerationInput): Promise<AiCallResult>;
  /** Slogans, devises en trois termes ou phrases de mission (§6.1). */
  abstract generateSlogans(input: SloganGenerationInput): Promise<AiCallResult>;
  /** Images pour le Studio de création (fonds, illustrations). */
  abstract generateImages(input: ImageGenerationInput): Promise<AiImagesResult>;
}
