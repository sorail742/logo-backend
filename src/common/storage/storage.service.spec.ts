import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDisposition, isSafeKey, StorageService } from './storage.service';

describe('StorageService (disque local)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-'));
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 'local',
    STORAGE_DIR: dir,
    S3_BUCKET: 'logo',
    API_URL: 'http://api.test',
    JWT_ACTION_SECRET: 'x'.repeat(40),
  };
  const storage = new StorageService({
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function queryOf(url: string) {
    return Object.fromEntries(new URL(url).searchParams);
  }

  it('écrit, relit et supprime un fichier', async () => {
    await storage.put('exports/w1/kit.zip', Buffer.from('zip'));
    expect((await storage.get('exports/w1/kit.zip')).toString()).toBe('zip');
    await storage.delete('exports/w1/kit.zip');
    await storage.delete('exports/w1/kit.zip');
    await expect(storage.get('exports/w1/kit.zip')).rejects.toThrow();
  });

  it('signe une URL que seul le serveur sait vérifier', async () => {
    const url = await storage.signedUrl('kits/w1/charte.pdf', {
      fileName: 'Charte é.pdf',
      inline: true,
    });
    expect(url.startsWith('http://api.test/api/v1/files?')).toBe(true);
    const file = storage.resolveSigned(queryOf(url));
    expect(file).toMatchObject({
      fileName: 'Charte é.pdf',
      contentType: 'application/pdf',
      inline: true,
    });
    expect(file).toMatchObject({ key: 'kits/w1/charte.pdf', root: dir });

    expect(storage.resolveSigned({ ...queryOf(url), sig: 'faux' })).toBeNull();
    expect(storage.resolveSigned({ ...queryOf(url), key: 'kits/w2/charte.pdf' })).toBeNull();
    expect(storage.resolveSigned({ ...queryOf(url), d: 'attachment' })).toBeNull();
  });

  it('refuse une URL expirée', async () => {
    const url = await storage.signedUrl('a/b.zip', { expiresIn: -1 });
    expect(storage.resolveSigned(queryOf(url))).toBeNull();
  });

  it('refuse les clés qui sortent du dossier', async () => {
    expect(isSafeKey('exports/w1/a.zip')).toBe(true);
    expect(isSafeKey('../etc/passwd')).toBe(false);
    expect(isSafeKey('a/../../b')).toBe(false);
    expect(isSafeKey('/abs')).toBe(false);
    await expect(storage.put('a/../../b', Buffer.from(''))).rejects.toThrow(
      'Clé de stockage invalide',
    );
  });

  it('nomme le fichier téléchargé en UTF-8', () => {
    expect(contentDisposition('Charte « Kola ».pdf')).toBe(
      `attachment; filename="Charte _ Kola _.pdf"; filename*=UTF-8''Charte%20%C2%AB%20Kola%20%C2%BB.pdf`,
    );
  });
});
