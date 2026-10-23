import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { createHash } from 'node:crypto';

/** Hachage argon2id et contrôle des mots de passe compromis (§14.1). */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  hash(password: string) {
    return hash(password, { type: argon2id });
  }

  verify(hash: string, password: string) {
    return verify(hash, password).catch(() => false);
  }

  async assertStrong(password: string) {
    if (password.length < 8) throw new BadRequestException('8 caractères minimum');
    if (await this.isPwned(password)) {
      throw new BadRequestException(
        'Ce mot de passe figure dans des fuites de données connues, choisissez-en un autre',
      );
    }
  }

  /**
   * API « Pwned Passwords » par k-anonymat : seuls les 5 premiers caractères du SHA-1 sortent.
   * En cas d'indisponibilité du service, l'inscription n'est pas bloquée.
   */
  private async isPwned(password: string): Promise<boolean> {
    // SHA-1 imposé par l'API (k-anonymat) : jamais utilisé pour stocker un mot de passe.
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase(); // NOSONAR
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return false;
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn(`Vérification des mots de passe compromis indisponible : ${String(err)}`);
      return false;
    }
  }
}
