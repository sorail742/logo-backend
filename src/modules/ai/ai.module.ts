import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider } from './ai-provider';
import { MockAiProvider } from './providers/mock.provider';

/** Choix du fournisseur actif par configuration (AI_PROVIDER). */
@Global()
@Module({
  providers: [
    MockAiProvider,
    {
      provide: AiProvider,
      inject: [ConfigService, MockAiProvider],
      useFactory: (config: ConfigService, mock: MockAiProvider): AiProvider => {
        switch (config.get<string>('AI_PROVIDER')) {
          case 'mock':
          default:
            return mock;
        }
      },
    },
  ],
  exports: [AiProvider],
})
export class AiModule {}
