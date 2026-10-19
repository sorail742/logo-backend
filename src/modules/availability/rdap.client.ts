import { Injectable, Logger } from '@nestjs/common';

const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 3600_000;
const LOOKUP_TIMEOUT_MS = 8000;

export type RdapResult =
  | { status: 'AVAILABLE' | 'TAKEN'; server: string }
  | { status: 'UNKNOWN'; reason: string };

interface Bootstrap {
  services: [string[], string[]][];
}

/**
 * Client RDAP (NOM-20). Interroge directement le serveur du registre trouvé dans le fichier
 * d'amorçage IANA plutôt qu'un relais : plus rapide, et un 404 y signifie bien « non enregistré ».
 * Une extension sans serveur RDAP (ex. .gn) donne UNKNOWN, jamais AVAILABLE.
 */
@Injectable()
export class RdapClient {
  private readonly logger = new Logger(RdapClient.name);
  private bootstrap: { at: number; servers: Map<string, string> } | null = null;

  async lookup(domain: string): Promise<RdapResult> {
    const tld = domain.slice(domain.lastIndexOf('.') + 1).toLowerCase();
    const server = (await this.servers()).get(tld);
    if (!server) return { status: 'UNKNOWN', reason: `Pas de serveur RDAP pour .${tld}` };

    try {
      const res = await fetch(`${server.replace(/\/?$/, '/')}domain/${domain}`, {
        headers: { Accept: 'application/rdap+json' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (res.status === 404) return { status: 'AVAILABLE', server };
      if (res.ok) return { status: 'TAKEN', server };
      return { status: 'UNKNOWN', reason: `Réponse ${res.status} du registre` };
    } catch (err) {
      this.logger.debug(`RDAP ${domain} : ${String(err)}`);
      return { status: 'UNKNOWN', reason: 'Registre injoignable' };
    }
  }

  private async servers(): Promise<Map<string, string>> {
    if (this.bootstrap && Date.now() - this.bootstrap.at < BOOTSTRAP_TTL_MS) {
      return this.bootstrap.servers;
    }
    try {
      const res = await fetch(IANA_BOOTSTRAP_URL, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      const data = (await res.json()) as Bootstrap;
      const servers = new Map<string, string>();
      for (const [tlds, urls] of data.services) {
        const url = urls.find((u) => u.startsWith('https://')) ?? urls[0];
        for (const t of tlds) servers.set(t.toLowerCase(), url);
      }
      this.bootstrap = { at: Date.now(), servers };
    } catch (err) {
      this.logger.warn(`Amorçage RDAP IANA indisponible : ${String(err)}`);
      // On garde l'ancienne table si elle existe, sinon aucune vérification possible.
      if (!this.bootstrap) return new Map();
    }
    return this.bootstrap!.servers;
  }
}
