import { containsTerm, ModerationService } from './moderation.service';

describe('ModerationService', () => {
  const prisma = {
    blockedTerm: {
      findMany: jest.fn().mockResolvedValue([
        { term: 'République', scope: 'STAMP' },
        { term: 'idiot', scope: 'NAME' },
      ]),
    },
  };
  const service = new ModerationService(prisma as never);

  it('détecte un terme officiel sans tenir compte des accents ni de la casse', async () => {
    expect(await service.findBlocked('Cachet de la REPUBLIQUE de Guinée', 'STAMP')).toEqual(['République']);
  });

  it('ne déclenche que sur des mots entiers', () => {
    expect(containsTerm('Idiotisme', 'idiot')).toBe(false);
    expect(containsTerm('Club des idiots', 'idiot')).toBe(false);
    expect(containsTerm('Club idiot', 'idiot')).toBe(true);
  });

  it('filtre les marques célèbres dans les noms', async () => {
    expect(await service.isAllowed('Google Solidaire', 'NAME')).toBe(false);
    expect(await service.isAllowed('Kalora', 'NAME')).toBe(true);
  });

  it('respecte le périmètre du terme', async () => {
    expect(await service.isAllowed('République des jeunes', 'NAME')).toBe(true);
  });
});
