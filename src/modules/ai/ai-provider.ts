import type { NameGenerationInput } from '../../shared/ai-schemas';

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
}
