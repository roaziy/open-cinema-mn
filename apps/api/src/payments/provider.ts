export interface PaymentProvider {
  createInvoice(b: { bookingId: string; amount: number; description: string }): Promise<{
    invoiceId: string;
    qrText: string;
    deeplinks: { name: string; url: string }[];
    expiresAt: Date;
  }>;
  checkPayment(invoiceId: string): Promise<'pending' | 'paid' | 'failed'>;
  refund(invoiceId: string): Promise<void>;
}

/** Placeholder until the mock provider lands: invoices stay pending forever. */
export class NoopPaymentProvider implements PaymentProvider {
  async createInvoice(b: { bookingId: string; amount: number; description: string }) {
    return {
      invoiceId: `noop-${b.bookingId}`,
      qrText: `noop:${b.bookingId}`,
      deeplinks: [],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
  }
  async checkPayment(_invoiceId: string) {
    return 'pending' as const;
  }
  async refund(_invoiceId: string) {}
}

export function createPayments(): PaymentProvider {
  return new NoopPaymentProvider();
}
