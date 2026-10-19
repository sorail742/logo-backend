import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string; // ex. "credits.adjust"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Journal des actions sensibles (§3, ADM-15) : auteur, date, avant/après, adresse IP. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry, tx: Tx = this.prisma) {
    return tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: entry.ip,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  // BigInt n'est pas sérialisable en JSON : conversion en chaîne.
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
