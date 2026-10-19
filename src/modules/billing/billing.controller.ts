import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { cursorArgs, CursorPaginationDto, toPage } from '../../common/dto/pagination.dto';
import { Public, WorkspaceAccess } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { activePlanCode } from './plan-features';

/**
 * Offres et crédits (§8, §13.8). Le paiement (checkout, webhooks, factures) arrive en phase 6,
 * une fois l'agrégateur mobile money choisi.
 */
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('plans')
  async plans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceGnf: 'asc' },
    });
    // BigInt n'est pas sérialisable en JSON : montants en chaîne.
    return plans.map((p) => ({ ...p, priceGnf: p.priceGnf.toString() }));
  }

  @ApiBearerAuth()
  @Get('workspaces/:wid/credits')
  @WorkspaceAccess('OWNER', { staff: 'SUPPORT' })
  async credits(@Param('wid', ParseUUIDPipe) wid: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { creditBalance: true, subscription: { include: { plan: { select: { code: true, name: true } } } } },
    });
    return {
      balance: ws.creditBalance,
      planCode: activePlanCode(ws.subscription),
      renewsAt: ws.subscription?.currentPeriodEnd ?? null,
      subscription: ws.subscription,
    };
  }

  @ApiBearerAuth()
  @Get('workspaces/:wid/ledger')
  @WorkspaceAccess('OWNER', { staff: 'SUPPORT' })
  async ledger(@Param('wid', ParseUUIDPipe) wid: string, @Query() q: CursorPaginationDto) {
    const rows = await this.prisma.creditLedgerEntry.findMany({
      where: { workspaceId: wid },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    return toPage(rows, q.limit);
  }
}
