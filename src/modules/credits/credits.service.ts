import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LedgerReason } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';

export interface LedgerWrite {
  workspaceId: string;
  delta: number;
  reason: LedgerReason;
  jobId?: string;
  paymentId?: string;
  actorId?: string;
  note?: string;
}

/**
 * Grand livre de crédits immuable (PAY-05, §12.1) : chaque mouvement est une ligne,
 * le solde Workspace.creditBalance est mis à jour dans la même transaction.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Débite si le solde suffit ; sinon lève 402. À appeler dans une transaction. */
  async debit(tx: Tx, entry: Omit<LedgerWrite, 'delta'> & { amount: number }) {
    if (entry.amount <= 0) return;
    // Décrément conditionnel : aucun solde négatif possible même en cas de requêtes concurrentes.
    const updated = await tx.workspace.updateMany({
      where: { id: entry.workspaceId, creditBalance: { gte: entry.amount } },
      data: { creditBalance: { decrement: entry.amount } },
    });
    if (updated.count === 0) {
      throw new HttpException('Crédits insuffisants', HttpStatus.PAYMENT_REQUIRED);
    }
    const { amount, ...rest } = entry;
    await tx.creditLedgerEntry.create({ data: { ...rest, delta: -amount } });
  }

  /** Crédite l'espace (achat, abonnement, remboursement, ajustement). */
  async credit(tx: Tx, entry: LedgerWrite) {
    await tx.workspace.update({
      where: { id: entry.workspaceId },
      data: { creditBalance: { increment: entry.delta } },
    });
    await tx.creditLedgerEntry.create({ data: entry });
  }

  /** Ajustement manuel signé (positif ou négatif), le solde ne peut devenir négatif. */
  async adjust(tx: Tx, entry: LedgerWrite) {
    if (entry.delta < 0) {
      await this.debit(tx, { ...entry, amount: -entry.delta });
    } else {
      await this.credit(tx, entry);
    }
  }

  /** Rembourse le débit d'une tâche une seule fois (idempotent). */
  async refundJob(tx: Tx, jobId: string) {
    const entries = await tx.creditLedgerEntry.findMany({ where: { jobId } });
    const net = entries.reduce((sum, e) => sum + e.delta, 0);
    if (net >= 0 || entries.length === 0) return;
    await this.credit(tx, {
      workspaceId: entries[0].workspaceId,
      delta: -net,
      reason: LedgerReason.REFUND,
      jobId,
      note: 'Remboursement automatique : génération échouée',
    });
  }

  balance(workspaceId: string) {
    return this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });
  }

  /** Recalcule les soldes depuis le grand livre (contrôle nocturne, §12.1). */
  async reconcileBalances(): Promise<{ workspaceId: string; cached: number; actual: number }[]> {
    const sums = await this.prisma.creditLedgerEntry.groupBy({
      by: ['workspaceId'],
      _sum: { delta: true },
    });
    const drift: { workspaceId: string; cached: number; actual: number }[] = [];
    for (const s of sums) {
      const actual = s._sum.delta ?? 0;
      const ws = await this.prisma.workspace.findUnique({
        where: { id: s.workspaceId },
        select: { creditBalance: true },
      });
      if (ws && ws.creditBalance !== actual) {
        drift.push({ workspaceId: s.workspaceId, cached: ws.creditBalance, actual });
        await this.prisma.workspace.update({
          where: { id: s.workspaceId },
          data: { creditBalance: actual },
        });
      }
    }
    return drift;
  }
}
