import { describe, expect, it } from 'vitest';
import { resolveDbSsl } from '../src/db/ssl';

const base = 'postgresql://u:p@h:5432/db';
const cfg = (
  url: string,
  ssl?: 'off' | 'require' | 'verify',
  ca?: string,
  fallback: 'off' | 'require' = 'off',
) => ({
  DATABASE_URL: url,
  DATABASE_SSL: ssl ?? fallback,
  DATABASE_SSL_SET: ssl !== undefined,
  DATABASE_CA_FILE: ca,
});
const read = (p: string) => `PEM(${p})`;

describe('resolveDbSsl', () => {
  it('uses the default when nothing is set', () => {
    expect(resolveDbSsl(cfg(base)).ssl).toBe(false);
    expect(resolveDbSsl(cfg(base, undefined, undefined, 'require'))).toMatchObject({
      level: 'require',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('require encrypts without checking the server', () => {
    expect(resolveDbSsl(cfg(base, 'require')).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('verify uses the CA file, or the system store without one', () => {
    expect(resolveDbSsl(cfg(base, 'verify', '/ca.pem'), read).ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'PEM(/ca.pem)',
    });
    expect(resolveDbSsl(cfg(base, 'verify')).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('honours sslmode=verify-full, reading sslrootcert, and strips the parameters', () => {
    const r = resolveDbSsl(
      cfg(`${base}?sslmode=verify-full&sslrootcert=/x.pem&application_name=a`),
      read,
    );
    expect(r.level).toBe('verify');
    expect(r.ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM(/x.pem)' });
    expect(r.url).toBe(`${base}?application_name=a`);
  });

  it('DATABASE_CA_FILE wins over sslrootcert', () => {
    const r = resolveDbSsl(
      cfg(`${base}?sslmode=verify-full&sslrootcert=/x.pem`, undefined, '/own.pem'),
      read,
    );
    expect(r.ssl).toMatchObject({ ca: 'PEM(/own.pem)' });
  });

  it('verify-ca checks the chain but not the host name', () => {
    const r = resolveDbSsl(cfg(`${base}?sslmode=verify-ca`));
    expect(r.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(typeof (r.ssl as { checkServerIdentity?: unknown }).checkServerIdentity).toBe(
      'function',
    );
    const full = resolveDbSsl(cfg(`${base}?sslmode=verify-full`));
    expect((full.ssl as { checkServerIdentity?: unknown }).checkServerIdentity).toBeUndefined();
  });

  it('maps require and disable from the URL', () => {
    expect(resolveDbSsl(cfg(`${base}?sslmode=require`)).ssl).toEqual({ rejectUnauthorized: false });
    expect(resolveDbSsl(cfg(`${base}?sslmode=disable`, undefined, undefined, 'require')).ssl).toBe(
      false,
    );
  });

  it('refuses a DATABASE_SSL weaker than the URL, naming both', () => {
    expect(() => resolveDbSsl(cfg(`${base}?sslmode=verify-full`, 'require'))).toThrow(
      /DATABASE_SSL=require.*sslmode=verify-full/,
    );
    expect(() => resolveDbSsl(cfg(`${base}?sslmode=require`, 'off'))).toThrow(/DATABASE_SSL=off/);
    expect(() => resolveDbSsl(cfg(`${base}?sslmode=verify-ca`, 'off'))).toThrow(
      /sslmode=verify-ca/,
    );
  });

  it('DATABASE_SSL=verify with sslmode=verify-full (the documented pair) starts and verifies the host', () => {
    const r = resolveDbSsl(cfg(`${base}?sslmode=verify-full`, 'verify', '/ca.pem'), read);
    expect(r.level).toBe('verify');
    expect(r.ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM(/ca.pem)' });
    expect(() => resolveDbSsl(cfg(`${base}?sslmode=verify-ca`, 'verify'))).not.toThrow();
  });

  it('allows a stronger DATABASE_SSL than the URL', () => {
    expect(resolveDbSsl(cfg(`${base}?sslmode=require`, 'verify')).level).toBe('verify');
    expect(resolveDbSsl(cfg(`${base}?sslmode=disable`, 'off')).ssl).toBe(false);
  });

  it('refuses DATABASE_SSL=verify with ssl=0 in the URL', () => {
    expect(() => resolveDbSsl(cfg(`${base}?ssl=0`, 'verify'))).toThrow(
      /DATABASE_SSL=verify.*ssl=0/,
    );
    expect(() => resolveDbSsl(cfg(`${base}?ssl=false`, 'require'))).toThrow(/ssl=false/);
  });

  it('ssl=0 alone resolves to off, which index.ts warns about in production', () => {
    const r = resolveDbSsl(cfg(`${base}?ssl=0`, undefined, undefined, 'require'));
    expect(r.level).toBe('off');
    expect(r.ssl).toBe(false);
    expect(resolveDbSsl(cfg(`${base}?ssl=disable`)).level).toBe('off');
  });

  it('ssl=1 alone resolves to require', () => {
    const r = resolveDbSsl(cfg(`${base}?ssl=1`));
    expect(r.level).toBe('require');
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(resolveDbSsl(cfg(`${base}?ssl=true`)).level).toBe('require');
  });

  it('sslnegotiation=direct keeps TLS on', () => {
    expect(resolveDbSsl(cfg(`${base}?sslnegotiation=direct`)).level).toBe('require');
    expect(resolveDbSsl(cfg(`${base}?ssl=0&sslnegotiation=direct`)).level).toBe('require');
  });

  it('strips ssl and sslnegotiation from the returned URL', () => {
    const r = resolveDbSsl(cfg(`${base}?ssl=0&sslnegotiation=postgres&application_name=a`, 'off'));
    expect(r.url).toBe(`${base}?application_name=a`);
    expect(resolveDbSsl(cfg(`${base}?ssl=1&sslnegotiation=direct`)).url).toBe(base);
  });
});
