import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, Public, WorkspaceAccess } from '../../common/decorators';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { CreateCheckoutDto, SimulatePaymentDto } from './payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initier un paiement ou une souscription (PAY-01, PAY-02)' })
  @ApiHeader({ name: 'idempotency-key', required: false, description: 'Clé d’idempotence' })
  @Post('workspaces/:wid/checkout')
  @WorkspaceAccess('OWNER')
  checkout(
    @Param('wid', ParseUUIDPipe) wid: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.createCheckout(wid, user.id, dto, idempotencyKey);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historique des paiements de l’espace' })
  @Get('workspaces/:wid/payments')
  @WorkspaceAccess('OWNER', { staff: 'SUPPORT' })
  listPayments(@Param('wid', ParseUUIDPipe) wid: string, @Query() q: CursorPaginationDto) {
    return this.paymentsService.listWorkspacePayments(wid, q);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Télécharger une facture PDF acquittée (PAY-04)' })
  @Get('invoices/:id/download')
  downloadInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getInvoiceDownloadUrl(id);
  }

  @Public()
  @ApiOperation({ summary: 'Réception des webhooks des opérateurs de paiement (PAY-03)' })
  @Post('payments/webhooks/:provider')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Param('provider') provider: PaymentProvider,
    @Headers() headers: Record<string, string | string[]>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.paymentsService.handleWebhook(provider, headers, body);
  }

  @Public()
  @ApiOperation({ summary: 'Simulation de validation de paiement (Bac à sable / Recette E2E)' })
  @Post('payments/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@Body() dto: SimulatePaymentDto) {
    return this.paymentsService.simulatePayment(dto);
  }
}
