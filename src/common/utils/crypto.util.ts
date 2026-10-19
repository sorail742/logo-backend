import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Jeton aléatoire URL-safe (invitations, rafraîchissement, partage). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Empreinte SHA-256 : seuls les hachages des jetons sont stockés en base. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Chiffrement AES-256-GCM (secret TOTP). Format : iv.tag.ciphertext en base64url. */
export function encrypt(plain: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string, hexKey: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
