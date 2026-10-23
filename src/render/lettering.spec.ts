import { renderDesignPage } from './design';
import { designDocSchema } from './design-doc';
import {
  halftoneDots,
  hasEffects,
  letteringLayers,
  patternShapes,
  textEffectsSchema,
} from './lettering';

const box = { x: 0, y: 0, width: 200, height: 100 };

describe('effets de lettrage', () => {
  it('ignore les effets vides', () => {
    expect(hasEffects(null)).toBe(false);
    expect(hasEffects({ outline2: null, inline: null })).toBe(false);
    expect(hasEffects({ halftone: { color: '#ffffff', size: 10, angle: 90 } })).toBe(true);
  });

  it('fait grossir les points de la trame dans la direction de l’angle', () => {
    const radii = (angle: number) =>
      [
        ...halftoneDots(box, { color: '#fff', size: 10, angle }).matchAll(
          /cy="([\d.-]+)" r="([\d.]+)"/g,
        ),
      ].map((m) => ({ y: Number(m[1]), r: Number(m[2]) }));
    const down = radii(90);
    const top = down.filter((d) => d.y < 30).map((d) => d.r);
    const bottom = down.filter((d) => d.y > 70).map((d) => d.r);
    expect(Math.max(...top)).toBeLessThan(Math.min(...bottom));
    // Grille élargie au-delà de 6 000 points.
    const huge = halftoneDots(
      { x: 0, y: 0, width: 5000, height: 5000 },
      { color: '#fff', size: 1, angle: 0 },
    );
    expect(huge.split('<circle').length - 1).toBeLessThan(7000);
  });

  it('dessine les calques dans l’ordre : relief, second contour, contour, remplissage, trame, liseré', () => {
    const defs: string[] = [];
    const svg = letteringLayers({
      box,
      defs,
      pid: 'e1',
      glyphs: '<path d="M0 0h10v10H0z"/>',
      fill: '#ffffff',
      stroke: { color: '#111111', width: 4 },
      effects: {
        outline2: { color: '#facc15', width: 3 },
        extrude: { color: '#7c2d12', depth: 12, angle: 45 },
        halftone: { color: '#000000', size: 8, angle: 90 },
        inline: { color: '#1d4ed8', width: 2, inset: 5 },
      },
      size: 100,
    });
    const order = [
      '#7c2d12',
      '#facc15',
      'fill="#111111"',
      'fill="#ffffff"',
      'fill="#000000"',
      'fill="#1d4ed8"',
    ];
    const positions = order.map((needle) => svg.indexOf(needle));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Contours : épaisseur visible = moitié du trait ; second contour autour du premier.
    expect(svg).toContain('stroke="#facc15" stroke-width="14"');
    expect(svg).toContain('stroke="#111111" stroke-width="8"');
    // Découpe sans <use> vers un groupe (interdit dans un clipPath), liseré par masque.
    const clip = defs.find((d) => d.startsWith('<clipPath'));
    expect(clip).toBe('<clipPath id="e1-clip"><path d="M0 0h10v10H0z"/></clipPath>');
    expect(defs.some((d) => d.startsWith('<mask id="e1-inline"'))).toBe(true);
  });

  it('dessine les textures de façon déterministe (même dessin au navigateur)', () => {
    const shapes = (kind: 'stripes' | 'carbon' | 'distressed' | 'claws') =>
      patternShapes(box, { kind, color: '#000000', size: 8, angle: -30 });
    expect(shapes('distressed')).toBe(shapes('distressed'));
    expect(shapes('claws').match(/<path /g)).toHaveLength(3);
    expect(shapes('stripes')).toMatch(/^<g transform="rotate\(-30 100 50\)"><rect /);
    expect(shapes('carbon').split('<rect').length - 1).toBeGreaterThan(100);
  });

  it('trace plusieurs lignes de liseré et un second contour cranté', () => {
    const defs: string[] = [];
    const svg = letteringLayers({
      box,
      defs,
      pid: 'e2',
      glyphs: '<path d="M0 0h10v10H0z"/>',
      fill: '#ffffff',
      effects: {
        outline2: { color: '#111111', width: 4, notched: true },
        inline: { color: '#1d4ed8', width: 2, inset: 3, lines: 3, gap: 1 },
      },
      size: 100,
    });
    const mask = defs.find((d) => d.startsWith('<mask'))!;
    expect(mask.match(/stroke="#fff"/g)).toHaveLength(3);
    // Anneaux : bords intérieurs à 3, 6 et 9 (largeur 2, écart 1).
    expect(mask).toContain('stroke="#000" stroke-width="18"');
    expect(svg).toContain('stroke-dasharray="6.4 4"');
    expect(
      textEffectsSchema.safeParse({
        pattern: { kind: 'claws', color: '#000000', size: 9, angle: -60 },
      }).success,
    ).toBe(true);
    expect(
      textEffectsSchema.safeParse({
        pattern: { kind: 'paillettes', color: '#000000', size: 9, angle: 0 },
      }).success,
    ).toBe(false);
  });

  it('conserve les effets du document et les rend côté serveur', () => {
    const doc = designDocSchema.parse({
      version: 1,
      width: 800,
      height: 400,
      pages: [
        {
          id: 'p1',
          background: { type: 'solid', color: '#1d4ed8' },
          elements: [
            {
              id: 't1',
              type: 'text',
              x: 0,
              y: 0,
              width: 800,
              height: 300,
              rotation: 0,
              opacity: 1,
              text: '10',
              lines: ['10'],
              fontId: 'graduate',
              fontWeight: 400,
              fontSize: 240,
              letterSpacing: 0,
              lineHeight: 1.1,
              align: 'center',
              uppercase: false,
              fill: { type: 'solid', color: '#ffffff' },
              effects: { inline: { color: '#1d4ed8', width: 4, inset: 8 } },
            },
          ],
        },
      ],
    });
    const element = doc.pages[0].elements[0];
    expect(element.type === 'text' && element.effects?.inline?.width).toBe(4);
    const svg = renderDesignPage(doc, 0);
    expect(svg).toContain('<mask id=');
    expect(svg).toMatch(/<use href="#[\w-]+-g" fill="#ffffff"\/>/);
  });
});
