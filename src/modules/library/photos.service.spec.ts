import {
  BadGatewayException,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../../config/env';
import { downloadUrl, normalizePage, PhotosService } from './photos.service';

const photo = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  width: 4000,
  height: 6000,
  url: `https://www.pexels.com/photo/marche-${id}/`,
  photographer: 'Awa Camara',
  photographer_url: 'https://www.pexels.com/@awa',
  avg_color: '#A0522D',
  alt: ' Étals de tissus ',
  src: {
    original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`,
    medium: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?h=350`,
  },
  ...overrides,
});

function service(key: string | undefined) {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => Promise.resolve(void store.set(k, v))),
  };
  const config = { get: () => key } as unknown as ConfigService<Env, true>;
  return { photos: new PhotosService(config, redis as unknown as Redis), redis };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('banque de photos (Pexels)', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());

  it('normalise une page et écarte les photos mal formées ou hors de Pexels', () => {
    const page = normalizePage({
      page: 2,
      next_page: 'https://api.pexels.com/v1/search?page=3',
      photos: [
        photo(1),
        photo(2, {
          src: { original: 'https://evil.example/x.jpg', medium: 'https://evil.example/x.jpg' },
        }),
        photo(3, { width: 'large' }),
        photo(4, { avg_color: 'red', alt: null, photographer_url: 'https://evil.example/@x' }),
      ],
    });
    expect(page.page).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.photos.map((p) => p.id)).toEqual(['1', '4']);
    expect(page.photos[0]).toEqual({
      id: '1',
      width: 4000,
      height: 6000,
      alt: 'Étals de tissus',
      color: '#A0522D',
      thumbUrl: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?h=350',
      author: 'Awa Camara',
      authorUrl: 'https://www.pexels.com/@awa',
      pageUrl: 'https://www.pexels.com/photo/marche-1/',
      source: 'pexels',
    });
    // Couleur invalide ignorée, lien d'auteur hors Pexels remplacé par la page de la photo.
    expect(page.photos[1]).toMatchObject({
      color: null,
      alt: '',
      authorUrl: 'https://www.pexels.com/photo/marche-4/',
    });
  });

  it('borne le téléchargement à 2 400 px et refuse les autres hôtes', () => {
    expect(downloadUrl('https://images.pexels.com/photos/1/a.jpeg?w=99')).toBe(
      'https://images.pexels.com/photos/1/a.jpeg?auto=compress&cs=tinysrgb&fit=max&w=2400&h=2400',
    );
    expect(() => downloadUrl('http://images.pexels.com/photos/1/a.jpeg')).toThrow(
      BadGatewayException,
    );
    expect(() => downloadUrl('https://images.pexels.com.evil.example/a.jpeg')).toThrow(
      BadGatewayException,
    );
  });

  it('est désactivée sans clé (501 NOT_AVAILABLE), sans appel sortant', async () => {
    const { photos } = service(undefined);
    expect(photos.enabled).toBe(false);
    await expect(photos.search({ q: 'marché' })).rejects.toBeInstanceOf(NotImplementedException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cherche en français avec la clé, puis sert la même recherche depuis le cache', async () => {
    const { photos } = service('cle-pexels');
    fetchMock.mockResolvedValueOnce(json({ page: 1, photos: [photo(7)] }));
    const first = await photos.search({ q: ' marché ', orientation: 'portrait' });
    const second = await photos.search({ q: 'marché', orientation: 'portrait' });
    expect(first).toEqual(second);
    expect(first.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.pexels.com/v1/search?per_page=24&page=1&query=march%C3%A9&locale=fr-FR&orientation=portrait',
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe('cle-pexels');
  });

  it('propose la sélection du moment sans recherche et signale un quota atteint', async () => {
    const { photos } = service('cle-pexels');
    fetchMock.mockResolvedValueOnce(json({ code: 'rate' }, 429));
    await expect(photos.search({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.pexels.com/v1/curated?per_page=24&page=1',
    );
  });

  it('télécharge le fichier en contrôlant le type et le poids', async () => {
    const { photos } = service('cle-pexels');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const image = (type: string) => {
      const response = new Response(jpeg, { headers: { 'content-type': type } });
      Object.defineProperty(response, 'url', {
        value: 'https://images.pexels.com/photos/7/pexels-photo-7.jpeg',
      });
      return response;
    };
    fetchMock.mockResolvedValueOnce(json(photo(7))).mockResolvedValueOnce(image('image/jpeg'));
    const file = await photos.file(7);
    expect(file.contentType).toBe('image/jpeg');
    expect(file.data.equals(jpeg)).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      'https://images.pexels.com/photos/7/pexels-photo-7.jpeg?auto=compress',
    );

    // Fiche en cache : seul le fichier est redemandé, et un contenu non image est refusé.
    fetchMock.mockResolvedValueOnce(image('text/html'));
    await expect(photos.file(7)).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
