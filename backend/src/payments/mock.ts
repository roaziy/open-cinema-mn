import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { payments } from '../db/schema';
import { env } from '../env';
import type { PaymentProvider } from './provider';

export const MOCK_PROVIDER = 'mock';
export const INVOICE_TTL_MS = 10 * 60_000;

type MockState = 'pending' | 'paid' | 'failed' | 'refunded';
export type MockRaw = {
  state: MockState;
  qrText: string;
  deeplinks: { name: string; url: string }[];
  expiresAt: string;
};

/**
 * QPay-shaped provider for development: invoices live in the `payments` table and the "bank
 * screen" is the dev endpoint that calls `markPaid`.
 */
export class MockPaymentProvider implements PaymentProvider {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date,
  ) {}

  async createInvoice(b: { bookingId: string; amount: number; description: string }) {
    const invoiceId = `mock_${randomUUID()}`;
    const expiresAt = new Date(this.clock().getTime() + INVOICE_TTL_MS);
    const qrText = `${env.API_PUBLIC_URL}/v1/mock-pay/${invoiceId}`;
    const deeplinks = [{ name: 'Mock bank', url: `mockbank://pay?invoice=${invoiceId}` }];
    const raw: MockRaw = {
      state: 'pending',
      qrText,
      deeplinks,
      expiresAt: expiresAt.toISOString(),
    };
    await this.db.insert(payments).values({
      bookingId: b.bookingId,
      provider: MOCK_PROVIDER,
      invoiceId,
      amount: b.amount,
      raw,
    });
    return { invoiceId, qrText, deeplinks, expiresAt };
  }

  async checkPayment(invoiceId: string) {
    const raw = await this.readRaw(invoiceId);
    if (raw.state === 'paid') return 'paid' as const;
    if (raw.state === 'failed') return 'failed' as const;
    return 'pending' as const;
  }

  /** Dev endpoint: the customer "paid" in the mock bank. Paying twice is harmless. */
  async markPaid(invoiceId: string): Promise<void> {
    await this.setState(invoiceId, 'paid', ['pending', 'paid']);
  }

  async refund(invoiceId: string): Promise<void> {
    await this.setState(invoiceId, 'refunded', ['paid', 'refunded']);
  }

  private async readRaw(invoiceId: string): Promise<MockRaw> {
    const [row] = await this.db
      .select({ raw: payments.raw })
      .from(payments)
      .where(and(eq(payments.provider, MOCK_PROVIDER), eq(payments.invoiceId, invoiceId)))
      .limit(1);
    if (!row) throw new Error(`unknown mock invoice ${invoiceId}`);
    return row.raw as MockRaw;
  }

  private async setState(invoiceId: string, next: MockState, from: MockState[]): Promise<void> {
    const raw = await this.readRaw(invoiceId);
    if (!from.includes(raw.state)) {
      throw new Error(`mock invoice ${invoiceId} is ${raw.state}, cannot become ${next}`);
    }
    await this.db
      .update(payments)
      .set({ raw: { ...raw, state: next } })
      .where(and(eq(payments.provider, MOCK_PROVIDER), eq(payments.invoiceId, invoiceId)));
  }
}
