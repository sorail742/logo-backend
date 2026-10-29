import { Global, Module } from '@nestjs/common';
import { AiProvider } from './ai-provider';
import { MockAiProvider } from './providers/mock.provider';

/**
 * Fournisseur actif : AI_PROVIDER n'admet pour l'instant que « mock » (validé au démarrage) ;
 * un nouveau fournisseur s'ajoute ici avec son choix par configuration.
 */
@Global()
@Module({
  providers: [MockAiProvider, { provide: AiProvider, useExisting: MockAiProvider }],
  exports: [AiProvider],
})
export class AiModule {}
