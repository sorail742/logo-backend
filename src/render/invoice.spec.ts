import { renderInvoicePdf } from './invoice';

describe('renderInvoicePdf', () => {
  it('génère une facture PDF A4 complète avec totaux et QR code', async () => {
    const pdf = await renderInvoicePdf({
      number: 'FAC-2026-000042',
      issuedAt: new Date('2026-10-25T14:30:00Z'),
      paidAt: new Date('2026-10-25T14:32:00Z'),
      customer: {
        name: 'Mamadou Diallo',
        email: 'diallo@example.com',
        phone: '+224 621 11 22 33',
        workspaceName: 'Diallo Design',
      },
      items: [
        {
          description: 'Pack Identité — 100 crédits et kit complet',
          quantity: 1,
          unitPriceGnf: 150000n,
          totalGnf: 150000n,
        },
      ],
      subtotalGnf: 150000n,
      taxGnf: 27000n,
      totalGnf: 177000n,
      paymentMethod: 'Orange Money Guinée',
      paymentReference: 'OM-20261025-99881',
      verificationUrl: 'https://example.com/api/v1/invoices/verify/FAC-2026-000042',
    });

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(5000);
    // Vérifie la signature PDF standard (%PDF-)
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

