import { randomUUID } from 'node:crypto';
import type { Messages } from './index';

const BASE_URL = 'https://api.wesend.mn';

/** Thrown when wesend refuses or fails a send. `code` is wesend's error code when it gave one. */
export class MessageSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(`message send failed: ${code}`);
    this.name = 'MessageSendError';
  }
}

export type WesendOptions = {
  apiKey: string;
  fromName: string;
  replyTo?: string;
  fetch?: typeof fetch;
};

export class WesendMessages implements Messages {
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: WesendOptions) {
    this.doFetch = opts.fetch ?? fetch;
  }

  sms(to: string, text: string) {
    // wesend wants the 8-digit local number, not +976...
    return this.post('/v1/sms', { to: to.replace(/^\+?976/, ''), text });
  }

  email({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
    return this.post('/v1/email', {
      to,
      subject,
      html,
      text,
      from_name: this.opts.fromName,
      ...(this.opts.replyTo && { reply_to: this.opts.replyTo }),
    });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    let res: Response;
    try {
      res = await this.doFetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MessageSendError('network_error');
    }
    if (res.ok) return;
    let code = 'unknown_error';
    try {
      const json = (await res.json()) as { error?: { code?: unknown } };
      if (typeof json.error?.code === 'string') code = json.error.code;
    } catch {
      // keep the generic code
    }
    throw new MessageSendError(code, res.status);
  }
}
