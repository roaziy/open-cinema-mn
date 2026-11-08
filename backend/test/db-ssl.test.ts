import { describe, expect, it } from 'vitest';
import { dbSsl, stripSslMode } from '../src/db/ssl';

describe('dbSsl', () => {
  it('off disables TLS', () => {
    expect(dbSsl({ DATABASE_SSL: 'off', DATABASE_CA_FILE: undefined })).toBe(false);
  });

  it('require encrypts without checking the certificate', () => {
    expect(dbSsl({ DATABASE_SSL: 'require', DATABASE_CA_FILE: undefined })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('verify reads the CA file and rejects unauthorized peers', () => {
    const read = (p: string) => (p === '/ca.pem' ? 'PEM' : '');
    expect(dbSsl({ DATABASE_SSL: 'verify', DATABASE_CA_FILE: '/ca.pem' }, read)).toEqual({
      ca: 'PEM',
      rejectUnauthorized: true,
    });
    expect(() => dbSsl({ DATABASE_SSL: 'verify', DATABASE_CA_FILE: undefined })).toThrow(
      /DATABASE_CA_FILE/,
    );
  });
});

describe('stripSslMode', () => {
  it('drops ssl parameters that would override DATABASE_SSL and leaves other URLs alone', () => {
    expect(stripSslMode('postgresql://u:p@h:5432/db?sslmode=require&application_name=x')).toBe(
      'postgresql://u:p@h:5432/db?application_name=x',
    );
    const plain = 'postgresql://u:p%40w@h:5432/db';
    expect(stripSslMode(plain)).toBe(plain);
  });
});
