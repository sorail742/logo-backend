import { brandAssets } from './logo-assets';
import { DEFAULT_SPEC, type LogoSpec } from './logo-spec';
import {
  defaultSiteContent,
  renderSiteHtml,
  safeHref,
  siteMediaIds,
  siteMockupScenes,
  whatsappHref,
  type SiteContent,
  type SiteDefaultsInput,
  type SiteRenderInput,
} from './site';
import { parseSiteContent, SITE_SLUG } from './site-schema';

const spec: LogoSpec = {
  ...DEFAULT_SPEC,
  text: 'Kalossa',
  colors: { primary: '#0f6b5c', secondary: '#f2b705', text: '#14281d', background: '#f6fbf4' },
};
const assets = brandAssets({ kind: 'spec', spec });

const defaults: SiteDefaultsInput = {
  name: 'Kalossa',
  slogan: 'Le goût du pays',
  mission: 'nourrir Conakry avec des produits frais',
  sector: 'Restauration',
  values: ['fraîcheur', 'proximité'],
  audience: 'les familles',
  language: 'fr',
  colors: spec.colors,
  fonts: { heading: { id: 'montserrat', weight: 700 }, body: { id: 'inter', weight: 400 } },
  contact: { phone: '+224 620 00 00 00', email: 'contact@kalossa.gn' },
  social: { facebook: 'facebook.com/kalossa' },
  icons: ['utensils', 'truck'],
};

function render(content: SiteContent, overrides: Partial<SiteRenderInput> = {}) {
  return renderSiteHtml({
    content,
    name: 'Kalossa',
    logo: {
      color: assets.logo.color.svg,
      white: assets.logo.white.svg,
      mark: assets.mark.color.svg,
    },
    urls: {
      font: (id, weight, subset) => `/fonts/${id}-${weight}-${subset}.woff`,
      media: (id) => `/media/${id}`,
      mockup: (scene) => `/mockups/${scene}.jpg`,
      file: (name) => `/${name}`,
      form: '/messages',
      canonical: 'https://exemple.org/site/kalossa',
    },
    platform: { name: 'Marka', url: 'https://exemple.org' },
    ...overrides,
  });
}

describe('site web', () => {
  it('contenu de départ complet et valide (fr, en)', () => {
    for (const language of ['fr', 'en'] as const) {
      const content = defaultSiteContent({ ...defaults, language });
      const parsed = parseSiteContent(content);
      expect(parsed.success).toBe(true);
      expect(content.sections.map((s) => s.type)).toEqual([
        'hero',
        'about',
        'services',
        'gallery',
        'testimonials',
        'faq',
        'contact',
      ]);
      expect(content.contact.whatsapp).toBe('+224 620 00 00 00');
    }
    const content = defaultSiteContent(defaults);
    expect(content.seo.title).toBe('Kalossa — Le goût du pays');
    expect(content.sections[0]).toMatchObject({
      subtitle: 'Le goût du pays',
      ctaTarget: 'whatsapp',
    });
  });

  it('page complète : sections visibles, navigation, partage, formulaire', () => {
    const html = render(defaultSiteContent(defaults));
    expect(html.startsWith('<!doctype html><html lang="fr">')).toBe(true);
    expect(html).toContain('<link rel="canonical" href="https://exemple.org/site/kalossa">');
    expect(html).toContain('<meta property="og:image" content="/og.png">');
    expect(html).toContain('id="a-propos"');
    expect(html).toContain('data-action="/messages"');
    expect(html).toContain('https://wa.me/224620000000');
    expect(html).toContain("src:url('/fonts/montserrat-700-latin.woff')");
    // Témoignages et questions masqués par défaut : ni section, ni lien de menu.
    expect(html).not.toContain('id="temoignages"');
    expect(html).not.toContain('href="#questions"');
    expect(html).not.toContain('noindex');
  });

  it('textes échappés, liens dangereux écartés, données structurées sans « < »', () => {
    const content = defaultSiteContent(defaults);
    const hero = content.sections[0];
    if (hero.type === 'hero') hero.title = '<script>alert(1)</script>';
    content.social = { facebook: 'javascript:alert(1)', instagram: 'instagram.com/kalossa' };
    content.seo.description = 'Bio </script><script>alert(2)</script>';
    const html = render(content);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://instagram.com/kalossa"');
    const jsonLd = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(JSON.parse(jsonLd).description).toContain('</script>');
  });

  it('aperçu : non indexé, formulaire inactif, polices absentes ignorées', () => {
    const html = render(defaultSiteContent(defaults), {
      preview: true,
      urls: {
        font: (_id, _weight, subset) => (subset === 'latin' ? '/f.woff' : null),
        media: () => '',
        mockup: () => '',
        file: () => null,
        form: null,
        canonical: null,
      },
    });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('type="submit" disabled');
    expect(html).not.toContain('latin-ext');
    expect(html).not.toContain('og:image');
  });

  it('identifiants des SVG du logo préfixés : plusieurs logos par page', () => {
    const content = defaultSiteContent(defaults);
    const hero = content.sections[0];
    if (hero.type === 'hero') hero.image = null;
    const ids = [...render(content).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('images utilisées : mises en situation et médias des sections visibles', () => {
    const content = defaultSiteContent(defaults);
    const id = '1b7c5f4e-8a2d-4c1b-9f3e-2d6a7b8c9d0e';
    const hero = content.sections[0];
    if (hero.type === 'hero') hero.image = { kind: 'media', id, alt: 'Équipe' };
    expect(siteMediaIds(content)).toEqual([id]);
    expect(siteMockupScenes(content)).toEqual([
      'storefront',
      'tshirt',
      'cards',
      'bags',
      'van',
      'stand',
    ]);
  });

  it('schéma : une section par type, polices et scènes connues', () => {
    const content = defaultSiteContent(defaults);
    expect(
      parseSiteContent({ ...content, sections: [...content.sections, content.sections[1]] })
        .success,
    ).toBe(false);
    expect(
      parseSiteContent({
        ...content,
        fonts: { ...content.fonts, body: { id: 'comic-sans', weight: 400 } },
      }).success,
    ).toBe(false);
    const gallery = {
      type: 'gallery',
      visible: true,
      title: 'G',
      images: [{ kind: 'mockup', scene: 'moon' }],
    };
    expect(parseSiteContent({ ...content, sections: [gallery] }).success).toBe(false);
    expect(
      parseSiteContent({ ...content, colors: { ...content.colors, primary: 'red' } }).success,
    ).toBe(false);
  });

  it('adresses et liens', () => {
    expect(SITE_SLUG.test('kalossa-conakry')).toBe(true);
    expect(
      ['ab', '-kalossa', 'kalossa-', 'Kalossa', 'ka lossa'].some((s) => SITE_SLUG.test(s)),
    ).toBe(false);
    expect(safeHref('kalossa.gn')).toBe('https://kalossa.gn/');
    expect(safeHref('mailto:contact@kalossa.gn')).toBe('mailto:contact@kalossa.gn');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(whatsappHref('00224 620-00-00-00', 'Bonjour')).toBe(
      'https://wa.me/224620000000?text=Bonjour',
    );
    expect(whatsappHref('—')).toBeNull();
  });
});
