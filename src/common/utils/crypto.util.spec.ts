import { decrypt, encrypt, randomToken, sha256 } from './crypto.util';

const KEY = 'a'.repeat(64);

describe('crypto.util', () => {
  it('chiffre puis déchiffre un secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = encrypt(secret, KEY);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc, KEY)).toBe(secret);
  });

  it('refuse un texte chiffré altéré', () => {
    const enc = encrypt('x', KEY).split('.');
    enc[2] = Buffer.from('y').toString('base64url');
    expect(() => decrypt(enc.join('.'), KEY)).toThrow();
  });

  it('produit des jetons uniques et des empreintes stables', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256('abc')).toBe(sha256('abc'));
  });
});
