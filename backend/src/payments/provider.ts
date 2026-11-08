import type { Db } from '../db/client';
import { MockPaymentProvider } from './mock';

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

export function createPayments(db: Db, clock: () => Date): PaymentProvider {
  return new MockPaymentProvider(db, clock);
}
