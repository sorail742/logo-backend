import { BadRequestException } from '@nestjs/common';
import { parseElementContents } from './apparel-content';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function fieldsOf(contents: unknown[]) {
  try {
    parseElementContents(contents);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { fields: Record<string, string[]> })
      .fields;
  }
  throw new Error('contenu accepté');
}

describe('contenu des éléments textile', () => {
  it('accepte le contenu produit par l’éditeur et retire les champs inconnus', () => {
    const [text, image] = parseElementContents([
      {
        text: 'DIALLO',
        fontId: 'oswald',
        fontWeight: 700,
        fill: '#111111',
        textOutline: { color: '#FFFFFF', widthMm: 1.5 },
        curve: 20,
        colors: ['#111111', '#ffffff'],
        strokeMm: 4.2,
        gradient: false,
        source: 'library',
        injected: '<script>alert(1)</script>',
      },
      {
        photo: { src: PNG, naturalWidth: 1200, naturalHeight: 800, crop: null, flipX: true },
        source: 'upload',
        rightsAttested: true,
        pixelWidth: 1200,
      },
    ]);
    expect(text).not.toHaveProperty('injected');
    expect(text?.text).toBe('DIALLO');
    expect(image?.photo?.naturalWidth).toBe(1200);
  });

  it('nettoie le SVG d’un logo (scripts, gestionnaires d’événements, liens externes)', () => {
    const [logo] = parseElementContents([
      {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" fill="#0b3d91" onclick="alert(3)"/><image href="https://evil.example/x.png" width="5" height="5"/></svg>',
      },
    ]);
    expect(logo?.svg).toContain('fill="#0b3d91"');
    expect(logo?.svg).not.toMatch(/onload|onclick|<script|evil\.example/);
  });

  it('refuse un SVG inexploitable, une photo externe et une police inconnue, champ par champ', () => {
    expect(
      fieldsOf([
        { svg: '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>' },
        {
          photo: { src: 'https://tracker.example/pixel.png', naturalWidth: 10, naturalHeight: 10 },
        },
        { text: 'X', fontId: 'comic-sans', fill: 'rouge' },
      ]),
    ).toEqual({
      'elements.0.content.svg': ['Logo SVG non pris en charge'],
      'elements.1.content.photo.src': ['Image attendue en PNG ou JPEG intégré'],
      'elements.2.content.fontId': ['Police hors bibliothèque'],
      'elements.2.content.fill': ['Couleur au format #RRGGBB attendue'],
    });
  });

  it('borne les textes et les valeurs numériques', () => {
    const fields = fieldsOf([{ text: 'x'.repeat(201), curve: 500, spotColors: 0 }]);
    expect(Object.keys(fields).sort((a, b) => a.localeCompare(b))).toEqual([
      'elements.0.content.curve',
      'elements.0.content.spotColors',
      'elements.0.content.text',
    ]);
  });
});
