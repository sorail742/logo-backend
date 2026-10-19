import { BadRequestException } from '@nestjs/common';
import { closeKnownSlogan } from '../slogans/known-slogans';
import {
  emailTemplateKey,
  parseMembersCsv,
  parsePublicBrand,
  parseSignatureData,
  stampReviewTerms,
} from './signature-data';

describe('import CSV des membres (SIG-16)', () => {
  it('séparateur point-virgule, en-têtes français, guillemets', () => {
    const rows = parseMembersCsv(
      '﻿Nom;Fonction;E-mail;Téléphone\r\n"Bah; Mamadou";Trésorier;m@example.org;+224 621\r\n;sans nom;;\r\nFanta;;;',
    );
    expect(rows).toEqual([
      {
        fullName: 'Bah; Mamadou',
        jobTitle: 'Trésorier',
        email: 'm@example.org',
        phone: '+224 621',
      },
      { fullName: 'Fanta', jobTitle: '', email: '', phone: '' },
    ]);
  });

  it('séparateur virgule, en-têtes anglais, colonnes manquantes', () => {
    expect(parseMembersCsv('name,email\nAlpha,a@example.org')).toEqual([
      { fullName: 'Alpha', jobTitle: '', email: 'a@example.org', phone: '' },
    ]);
  });
});

describe('données de signature', () => {
  it('validées selon le type, erreurs détaillées', () => {
    expect(() => parseSignatureData('STAMP', { shape: 'triangle' })).toThrow(BadRequestException);
    expect(parseSignatureData('EMAIL', { fullName: 'A' }).data).toMatchObject({
      fullName: 'A',
      phones: [],
    });
  });

  it('termes du cachet à valider, sans doublon', () => {
    const stamp = parseSignatureData('STAMP', {
      shape: 'round',
      ringText: 'République de Guinée',
      centerMode: 'acronym',
      ink: 'blue',
    }).data as Parameters<typeof stampReviewTerms>[0];
    expect(stampReviewTerms(stamp, ['République'])).toEqual(['République']);
    expect(stampReviewTerms(stamp, [])).toEqual(['republique']);
  });

  it('modèle e-mail : classic par défaut, inconnu refusé', () => {
    expect(emailTemplateKey(undefined)).toBe('classic');
    expect(emailTemplateKey('banner')).toBe('banner');
    expect(() => emailTemplateKey('baroque')).toThrow(BadRequestException);
  });

  it('marque publique : logo en HTTPS absolu uniquement', () => {
    const brand = { name: 'Kaloum', primary: '#0f766e', secondary: '#f59e0b' };
    expect(parsePublicBrand(brand).name).toBe('Kaloum');
    expect(() => parsePublicBrand({ ...brand, logoUrl: 'javascript:alert(1)' })).toThrow(
      BadRequestException,
    );
  });
});

describe('slogans connus (SIG-04)', () => {
  it('reprise exacte ou quasi exacte écartée', () => {
    expect(closeKnownSlogan('Just do it!')).toBe('just do it');
    expect(closeKnownSlogan('Parce que vous le valez bien')).toBe('parce que vous le valez bien');
    expect(closeKnownSlogan('Think different, think Kaloum')).toBe('think different');
  });

  it('slogan original accepté', () => {
    expect(closeKnownSlogan('Agir ensemble pour Kaloum')).toBeNull();
    expect(closeKnownSlogan('Le savoir au service de tous')).toBeNull();
  });
});
