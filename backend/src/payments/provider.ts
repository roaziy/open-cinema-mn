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
  /**
   * Must be idempotent per invoice: refunding an invoice that is already refunded is a success,
   * not an error. The app retries after crashes and provider errors and relies on this.
   */
  refund(invoiceId: string): Promise<void>;
}

export function createPayments(db: Db, clock: () => Date): PaymentProvider {
  return new MockPaymentProvider(db, clock);
}
