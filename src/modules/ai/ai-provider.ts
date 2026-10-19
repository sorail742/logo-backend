import type { NameGenerationInput } from '../../shared/ai-schemas';
import type { LogoGenerationInput } from '../../shared/logo-spec';

export interface AiCallResult {
  /** Réponse brute, non fiable : à valider par schéma zod avant usage. */
  raw: unknown;
  provider: string;
  promptVersion: string;
  costUsdMicros: number;
}

/**
 * Abstraction des fournisseurs IA (NOM-10, §11.1) : le reste du code ne dépend que de cette interface.
 * Règle §14.1 : le brief est transmis comme donnée, jamais concaténé comme instruction.
 */
export abstract class AiProvider {
  abstract readonly name: string;
  abstract generateNames(input: NameGenerationInput): Promise<AiCallResult>;
  /**
   * Moteur A (§5.1) : l'IA choisit icône, police, palette et disposition ; le serveur assemble.
   * Réponse attendue : { logos: LogoSpec[] }, validée par generatedLogosSchema.
   */
  abstract composeLogos(input: LogoGenerationInput, count: number): Promise<AiCallResult>;
}
