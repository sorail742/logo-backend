import { Module } from '@nestjs/common';
import { AggregatorPaymentAdapter } from './adapters/aggregator.adapter';
import { CardPaymentAdapter } from './adapters/card.adapter';
import { OrangeMoneyAdapter } from './adapters/orange-money.adapter';
import { InvoicePdfService } from './invoice-pdf.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    InvoicePdfService,
    OrangeMoneyAdapter,
    CardPaymentAdapter,
    AggregatorPaymentAdapter,
  ],
  exports: [PaymentsService, InvoicePdfService],
})
export class PaymentsModule {}
