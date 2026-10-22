import { qrMatrix, qrSvg, vcard, whatsappLink, wifiPayload } from './qr';

/** Motif de repérage 7 × 7 attendu dans un coin. */
function hasFinder(m: boolean[][], x0: number, y0: number) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (m[y0 + y][x0 + x] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('QR code', () => {
  it('version 1 (21 modules) pour un texte court, motifs de repérage et de synchronisation', () => {
    const m = qrMatrix('kalossa.gn');
    expect(m).toHaveLength(21);
    expect(hasFinder(m, 0, 0) && hasFinder(m, 14, 0) && hasFinder(m, 0, 14)).toBe(true);
    for (let i = 8; i < 13; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    // Module sombre obligatoire, à côté du repère inférieur gauche.
    expect(m[21 - 8][8]).toBe(true);
  });

  it('les deux copies des informations de format concordent', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const m = qrMatrix('Kalossa — Conakry', level);
      const size = m.length;
      const first = Array.from({ length: 15 }, (_, i) => {
        if (i <= 5) return m[i][8];
        if (i === 6) return m[7][8];
        if (i === 7) return m[8][8];
        if (i === 8) return m[8][7];
        return m[8][14 - i];
      });
      const second = Array.from({ length: 15 }, (_, i) =>
        i < 8 ? m[8][size - 1 - i] : m[size - 15 + i][8],
      );
      expect(second).toEqual(first);
    }
  });

  it('la version grandit avec le contenu et le niveau de correction', () => {
    const card = vcard({
      fullName: 'Aminata Diallo',
      organization: 'Kalossa',
      phone: '+224 620 00 00 00',
      email: 'contact@kalossa.gn',
    });
    const low = qrMatrix(card, 'L').length;
    const high = qrMatrix(card, 'H').length;
    expect(high).toBeGreaterThan(low);
    // Version 7 et plus : bloc d'information de version (au-delà de 45 modules).
    expect(qrMatrix('x'.repeat(400)).length).toBeGreaterThanOrEqual(45);
    expect(() => qrMatrix('x'.repeat(4000))).toThrow('trop long');
  });

  it('SVG : un seul tracé, zone de silence de 4 modules', () => {
    const svg = qrSvg('kalossa.gn', { color: '#0f6b5c' });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill="#0f6b5c"');
  });

  it('contenus : WhatsApp, vCard, Wi-Fi', () => {
    expect(whatsappLink('+224 620 00 00 00', 'Bonjour !')).toBe(
      'https://wa.me/224620000000?text=Bonjour%20!',
    );
    expect(whatsappLink('00224 620 00 00 00')).toBe('https://wa.me/224620000000');
    const card = vcard({ fullName: 'Diallo; Aminata', phone: '+224 (620) 00-00-00' });
    expect(card).toContain('FN:Diallo\\; Aminata');
    expect(card).toContain('TEL;TYPE=CELL:+224620000000');
    expect(card.split('\r\n').at(-1)).toBe('END:VCARD');
    expect(wifiPayload('Boutique Kalossa', 'mot;passe')).toBe(
      'WIFI:T:WPA;S:Boutique Kalossa;P:mot\\;passe;;',
    );
    expect(wifiPayload('Invités')).toBe('WIFI:T:nopass;S:Invités;;');
  });
});
