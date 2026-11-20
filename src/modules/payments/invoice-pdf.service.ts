import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { InvoiceItem, renderInvoicePdf } from '../../render/invoice';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Génère la facture et son PDF vectoriel pour un paiement réussi (PAY-04).
   */
  async generateInvoice(
    tx: Tx,
    paymentId: string,
    customerInfo?: { name: string; email?: string; phone?: string },
  ): Promise<Invoice> {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        workspace: { select: { id: true, name: true } },
      },
    });

    // Évite les doublons si la facture existe déjà
    const existing = await tx.invoice.findUnique({ where: { paymentId } });
    if (existing) return existing;

    const year = new Date().getFullYear();
    const count = await tx.invoice.count();
    const invoiceNumber = `FAC-${year}-${String(count + 1).padStart(6, '0')}`;

    // Calcul de la taxe (ex. TVA 18% en Guinée par défaut, paramétrable)
    const taxPercent = Number(this.config.get('INVOICE_TAX_PERCENT') ?? 18);
    const totalGnf = payment.amountGnf;
    // total = subtotal * (1 + taxPercent / 100) -> subtotal = total / (1 + taxPercent / 100)
    const subtotalGnf = (totalGnf * 100n) / BigInt(100 + taxPercent);
    const taxGnf = totalGnf - subtotalGnf;

    // Détermination de la désignation
    let description = 'Prestation de services sur la plateforme';
    if (payment.planCode) {
      const plan = await tx.plan.findUnique({ where: { code: payment.planCode } });
      description = plan ? `Abonnement / Offre ${plan.name}` : `Offre ${payment.planCode}`;
    } else if (payment.creditsGranted) {
      description = `Recharge de ${payment.creditsGranted} crédits de génération`;
    }

    const item: InvoiceItem = {
      description,
      quantity: 1,
      unitPriceGnf: subtotalGnf,
      totalGnf: subtotalGnf,
    };

    const methodLabels: Record<string, string> = {
      ORANGE_MONEY: 'Orange Money Guinée',
      MOBILE_MONEY_AGGREGATOR: 'Mobile Money',
      CARD: 'Carte bancaire (Visa / Mastercard)',
    };

    const apiUrl = this.config.get('API_URL') ?? 'http://localhost:3001';
    const verificationUrl = `${apiUrl}/api/v1/invoices/verify/${invoiceNumber}`;

    const pdfBuffer = await renderInvoicePdf({
      number: invoiceNumber,
      issuedAt: payment.createdAt,
      paidAt: payment.updatedAt,
      customer: {
        name: customerInfo?.name ?? 'Client',
        email: customerInfo?.email,
        phone: customerInfo?.phone,
        workspaceName: payment.workspace.name,
      },
      items: [item],
      subtotalGnf,
      taxGnf,
      totalGnf,
      paymentMethod: methodLabels[payment.provider] ?? payment.provider,
      paymentReference: payment.providerRef ?? undefined,
      verificationUrl,
    });

    const pdfKey = `invoices/${payment.workspaceId}/${invoiceNumber}.pdf`;
    await this.storage.put(pdfKey, pdfBuffer, 'application/pdf');

    const invoice = await tx.invoice.create({
      data: {
        paymentId,
        number: invoiceNumber,
        amountGnf: totalGnf,
        taxGnf,
        pdfKey,
        issuedAt: new Date(),
      },
    });

    this.logger.log(
      `Facture ${invoiceNumber} générée avec succès pour l'espace ${payment.workspaceId}`,
    );
    return invoice;
  }
}
