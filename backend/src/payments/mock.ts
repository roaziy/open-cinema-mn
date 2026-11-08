import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
 * QPay-shaped provider for development: invoice state lives in `payments.raw` (the row is
 * written by the booking service) and the "bank screen" is the dev endpoint calling `markPaid`.
 */
export class MockPaymentProvider implements PaymentProvider {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date,
  ) {}

  /** Pure: the caller stores the invoice (`payments` row, state `pending`) in its transaction. */
  async createInvoice(b: { bookingId: string; amount: number; description: string }) {
    const invoiceId = `mock_${randomUUID()}`;
    const expiresAt = new Date(this.clock().getTime() + INVOICE_TTL_MS);
    // Opaque to the app: its mock bank screen posts to this route.
    const qrText = `${env.API_PUBLIC_URL}/v1/bookings/${b.bookingId}/mock-pay`;
    const deeplinks = [{ name: 'Mock bank', url: `mockbank://pay?invoice=${invoiceId}` }];
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

  /** Atomic compare-and-set in SQL, so concurrent callers cannot overwrite each other. */
  private async setState(invoiceId: string, next: MockState, from: MockState[]): Promise<void> {
    const res = await this.db
      .update(payments)
      .set({ raw: sql`jsonb_set(${payments.raw}, '{state}', to_jsonb(${next}::text))` })
      .where(
        and(
          eq(payments.provider, MOCK_PROVIDER),
          eq(payments.invoiceId, invoiceId),
          inArray(sql`${payments.raw}->>'state'`, from),
        ),
      )
      .returning({ id: payments.id });
    if (res.length === 0) {
      const raw = await this.readRaw(invoiceId);
      throw new Error(`mock invoice ${invoiceId} is ${raw.state}, cannot become ${next}`);
    }
  }
}
