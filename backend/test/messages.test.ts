import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/env';
import { DevMessages } from '../src/messages/dev';
import {
  bookingConfirmedEmail,
  otpEmail,
  otpSms,
  showtimeCancelledEmail,
} from '../src/messages/templates';
import { MessageSendError, WesendMessages } from '../src/messages/wesend';

function stubFetch(status: number, body: unknown = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

describe('wesend sender', () => {
  it('posts sms with the local number, bearer key and an idempotency key', async () => {
    const f = stubFetch(200, { id: 'm1', status: 'sent' });
    const w = new WesendMessages({ apiKey: 'ws_test_k', fromName: 'Op', fetch: f as typeof fetch });
    await w.sms('+97699112045', 'Open Cinema код: 123456');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.wesend.mn/v1/sms');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ws_test_k');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      to: '99112045',
      text: 'Open Cinema код: 123456',
    });
  });

  it('posts email with from_name and reply_to', async () => {
    const f = stubFetch(202, { id: 'e1' });
    const w = new WesendMessages({
      apiKey: 'k',
      fromName: 'Op Cinema',
      replyTo: 'help@op.mn',
      fetch: f as typeof fetch,
    });
    await w.email({ to: 'a@b.mn', subject: 'S', html: '<p>h</p>', text: 't' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.wesend.mn/v1/email');
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'a@b.mn',
      subject: 'S',
      html: '<p>h</p>',
      text: 't',
      from_name: 'Op Cinema',
      reply_to: 'help@op.mn',
    });
  });

  it('maps wesend error codes to MessageSendError', async () => {
    const f = stubFetch(422, { error: { code: 'unsupported_number', message: 'x' } });
    const w = new WesendMessages({ apiKey: 'k', fromName: 'Op', fetch: f as typeof fetch });
    await expect(w.sms('+97699112045', 't')).rejects.toMatchObject({
      name: 'MessageSendError',
      code: 'unsupported_number',
      status: 422,
    });
  });

  it('maps a network failure to MessageSendError', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const w = new WesendMessages({
      apiKey: 'k',
      fromName: 'Op',
      fetch: f as unknown as typeof fetch,
    });
    await expect(w.sms('+97699112045', 't')).rejects.toBeInstanceOf(MessageSendError);
  });
});

describe('templates', () => {
  it('keeps the otp sms short', () => {
    expect(otpSms('123456', 'Open Cinema')).toBe('Open Cinema код: 123456');
    expect(otpSms('123456', 'Open Cinema').length).toBeLessThanOrEqual(65);
  });

  it('renders the otp email with operator and code', () => {
    const m = otpEmail('123456', 'Acme Cinema');
    expect(m.subject).toContain('Acme Cinema');
    expect(m.html).toContain('123456');
    expect(m.text).toContain('123456');
  });

  it('renders the booking and cancellation emails and escapes input', () => {
    const b = bookingConfirmedEmail(
      {
        orderNo: 'OC-48213',
        movieTitle: 'A <b>film</b>',
        branchName: 'Төв салбар',
        hallName: 'Танхим 1',
        seats: ['F7', 'F8'],
        startsAt: '2026-11-08T17:30:00Z',
        total: 30000,
        ticketUrl: 'https://x.mn/t/abc',
      },
      'Op',
    );
    expect(b.html).not.toContain('<b>film</b>');
    expect(b.html).toContain('A &lt;b&gt;film&lt;/b&gt;');
    expect(b.text).toContain('₮30,000');
    expect(b.text).toContain('F7, F8');
    expect(b.text).toContain('2026-11-09 01:30'); // Ulaanbaatar time
    expect(b.subject).toContain('OC-48213');
    const c = showtimeCancelledEmail(
      {
        movieTitle: 'Film',
        branchName: 'Төв салбар',
        startsAt: '2026-11-08T17:30:00Z',
        refundNote: 'Мөнгөө буцаана.',
      },
      'Op',
    );
    expect(c.html).toContain('Мөнгөө буцаана.');
  });
});

describe('dev sender in production', () => {
  it('never logs the code, subject or body', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const dev = new DevMessages(true);
    const m = otpEmail('482913', 'Op');
    expect(m.subject).not.toContain('482913');
    await dev.sms('+97699112045', otpSms('482913', 'Op'));
    await dev.email({ to: 'a@b.mn', ...m });
    const out = spies
      .flatMap((s) => s.mock.calls)
      .flat()
      .join('\n');
    for (const s of spies) s.mockRestore();
    expect(out).toContain('a@b.mn');
    expect(out).not.toContain('482913');
    expect(out).not.toContain(m.subject);
  });
});

describe('env hardening', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/x',
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(32),
    QR_SECRET: 'q'.repeat(32),
    LINK_SECRET: 'l'.repeat(32),
    SEED_ADMIN_PASSWORD: 'a-real-password',
  };

  it('accepts a strong production config', () => {
    expect(() => parseEnv(base)).not.toThrow();
  });

  it('rejects short secrets in production but not in development', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short-secret' })).toThrow(/JWT_SECRET/);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'development', JWT_SECRET: 'short-secret' }),
    ).not.toThrow();
  });

  it('requires distinct secrets in production', () => {
    expect(() => parseEnv({ ...base, QR_SECRET: base.JWT_SECRET })).toThrow(/must all differ/);
    expect(() => parseEnv({ ...base, BFF_SECRET: base.LINK_SECRET })).toThrow(/must all differ/);
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'development', QR_SECRET: base.JWT_SECRET }),
    ).not.toThrow();
  });

  it('binds loopback in production and all interfaces otherwise unless HOST is set', () => {
    expect(parseEnv(base).HOST).toBe('127.0.0.1');
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).HOST).toBe('0.0.0.0');
    expect(parseEnv({ ...base, HOST: '10.0.0.5' }).HOST).toBe('10.0.0.5');
    expect(parseEnv({ ...base, HOST: '' }).HOST).toBe('127.0.0.1');
  });

  it('rejects the default admin password in production', () => {
    expect(() => parseEnv({ ...base, SEED_ADMIN_PASSWORD: 'change-me-admin' })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
    const { SEED_ADMIN_PASSWORD: _omit, ...noPassword } = base;
    expect(() => parseEnv(noPassword)).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('createMessages refuses wesend without an api key', async () => {
    vi.resetModules();
    vi.stubEnv('MESSAGES_PROVIDER', 'wesend');
    vi.stubEnv('WESEND_API_KEY', '');
    const { createMessages } = await import('../src/messages');
    expect(() => createMessages()).toThrow(/WESEND_API_KEY/);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
