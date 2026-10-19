import { Injectable } from '@nestjs/common';
import { CheckKind, CheckStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { scoreName } from '../names/name-score.util';
import { soundsSimilar } from './phonetic.util';
import { RdapClient } from './rdap.client';

/** Domaines vérifiés (NOM-20). */
export const CHECKED_TLDS = ['com', 'org', 'net', 'app', 'africa', 'gn'] as const;
/** Résultats mis en cache 24 h (NOM-25). */
export const CHECK_CACHE_MS = 24 * 3600_000;

const SOCIAL_NETWORKS: Record<string, (h: string) => string> = {
  facebook: (h) => `https://www.facebook.com/${h}`,
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
  github: (h) => `https://github.com/${h}`,
};

interface CheckResult {
  kind: CheckKind;
  target: string;
  status: CheckStatus;
  details?: Prisma.InputJsonValue;
}

/** Identifiant technique dérivé du nom : minuscules, sans accents ni espaces. */
export function toHandle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rdap: RdapClient,
  ) {}

  /** Lance (ou relit depuis le cache) toutes les vérifications d'un nom. */
  async check(nameId: string, force = false) {
    const name = await this.prisma.nameSuggestion.findUniqueOrThrow({
      where: { id: nameId },
      include: { checks: true },
    });

    const freshSince = new Date(Date.now() - CHECK_CACHE_MS);
    const cached = name.checks.length > 0 && name.checks.every((c) => c.checkedAt > freshSince);
    if (cached && !force) return this.present(name.checks, true);

    const handle = toHandle(name.value);
    const results = (
      await Promise.all([
        this.checkDomains(handle),
        this.checkSocial(handle),
        Promise.resolve(this.trademarkLinks(name.value)),
        this.checkPhonetic(name.value, name.projectId),
      ])
    ).flat();

    const checks = await this.prisma.$transaction(async (tx) => {
      await tx.availabilityCheck.deleteMany({ where: { nameId } });
      await tx.availabilityCheck.createMany({ data: results.map((r) => ({ ...r, nameId })) });
      const conclusive = results.filter(
        (r) => r.status !== CheckStatus.UNKNOWN && (r.kind === 'DOMAIN' || r.kind === 'SOCIAL'),
      );
      const availability = conclusive.length
        ? conclusive.filter((r) => r.status === CheckStatus.AVAILABLE).length / conclusive.length
        : undefined;
      await tx.nameSuggestion.update({
        where: { id: nameId },
        data: { score: scoreName({ value: name.value, availability }) },
      });
      return tx.availabilityCheck.findMany({ where: { nameId } });
    });
    return this.present(checks, false);
  }

  private present(checks: { checkedAt: Date }[], fromCache: boolean) {
    const lastCheckedAt = checks.reduce<Date | null>(
      (max, c) => (!max || c.checkedAt > max ? c.checkedAt : max),
      null,
    );
    return {
      fromCache,
      lastCheckedAt,
      notice:
        'Les résultats réseaux sociaux et marques sont indicatifs : vérifiez auprès des services officiels avant tout dépôt.',
      checks,
    };
  }

  // ─── Domaines via RDAP (NOM-20) ───

  private async checkDomains(handle: string): Promise<CheckResult[]> {
    return Promise.all(
      CHECKED_TLDS.map(async (tld): Promise<CheckResult> => {
        const domain = `${handle}.${tld}`;
        const result = await this.rdap.lookup(domain);
        if (result.status !== 'UNKNOWN') {
          return {
            kind: 'DOMAIN',
            target: domain,
            status: result.status,
            details: { source: result.server },
          };
        }
        return {
          kind: 'DOMAIN',
          target: domain,
          status: 'UNKNOWN',
          details: { reason: result.reason, manualCheck: `https://who.is/whois/${domain}` },
        };
      }),
    );
  }

  // ─── Réseaux sociaux, indicatif (NOM-21) ───

  private async checkSocial(handle: string): Promise<CheckResult[]> {
    return Promise.all(
      Object.entries(SOCIAL_NETWORKS).map(async ([network, url]): Promise<CheckResult> => {
        const details = { url: url(handle), indicative: true };
        // Seul GitHub expose une API publique fiable ; les autres réseaux bloquent les vérifications.
        if (network !== 'github')
          return { kind: 'SOCIAL', target: network, status: 'UNKNOWN', details };
        try {
          const res = await fetch(`https://api.github.com/users/${handle}`, {
            headers: { 'User-Agent': 'logo-backend' },
            signal: AbortSignal.timeout(3000),
          });
          const status: CheckStatus =
            res.status === 404 ? 'AVAILABLE' : res.ok ? 'TAKEN' : 'UNKNOWN';
          return { kind: 'SOCIAL', target: network, status, details };
        } catch {
          return { kind: 'SOCIAL', target: network, status: 'UNKNOWN', details };
        }
      }),
    );
  }

  // ─── Marques : liens de recherche pré-remplis (NOM-24) ───

  private trademarkLinks(name: string): CheckResult[] {
    const q = encodeURIComponent(name);
    return [
      {
        kind: 'TRADEMARK',
        target: 'wipo-gbd',
        status: 'UNKNOWN',
        details: {
          url: `https://branddb.wipo.int/fr/similarname/results?sort=score%20desc&strategy=concept&brandName=${q}`,
        },
      },
      {
        kind: 'TRADEMARK',
        target: 'oapi',
        status: 'UNKNOWN',
        details: {
          url: 'https://www.oapi.int/',
          hint: `Rechercher « ${name} » dans la base des marques OAPI`,
        },
      },
    ];
  }

  // ─── Comparaison phonétique aux noms déjà retenus sur la plateforme (NOM-23) ───

  private async checkPhonetic(value: string, projectId: string): Promise<CheckResult[]> {
    const chosen = await this.prisma.nameSuggestion.findMany({
      where: { chosenFor: { isNot: null }, projectId: { not: projectId } },
      select: { value: true },
      take: 5000,
    });
    const similar = chosen
      .map((c) => c.value)
      .filter((v) => soundsSimilar(v, value))
      .slice(0, 5);
    return [
      {
        kind: 'PHONETIC',
        target: 'platform',
        status: similar.length ? 'TAKEN' : 'AVAILABLE',
        details: { similar },
      },
    ];
  }
}
