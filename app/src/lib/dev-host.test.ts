import { describe, expect, it } from 'vitest';
import { hostFromHostUri, resolveApiOrigin } from './dev-host';

const dev = { dev: true, hostUri: '192.168.1.197:8081' };

describe('hostFromHostUri', () => {
  it('extracts the host', () => {
    expect(hostFromHostUri('192.168.1.197:8081')).toBe('192.168.1.197');
    expect(hostFromHostUri('exp://192.168.1.197:8081/--/x')).toBe('192.168.1.197');
    expect(hostFromHostUri('mac.local:8081')).toBe('mac.local');
  });
  it('rejects empty and loopback', () => {
    expect(hostFromHostUri(undefined)).toBeNull();
    expect(hostFromHostUri('localhost:8081')).toBeNull();
    expect(hostFromHostUri('127.0.0.1:8081')).toBeNull();
  });
});

describe('resolveApiOrigin', () => {
  it('swaps localhost for the LAN host, keeping the port', () => {
    expect(resolveApiOrigin('http://localhost:4000', dev)).toBe('http://192.168.1.197:4000');
    expect(resolveApiOrigin('http://127.0.0.1:4000', dev)).toBe('http://192.168.1.197:4000');
    expect(resolveApiOrigin('http://[::1]:4000', dev)).toBe('http://192.168.1.197:4000');
  });
  it('keeps a base path', () => {
    expect(resolveApiOrigin('http://localhost:4000/api', dev)).toBe(
      'http://192.168.1.197:4000/api',
    );
  });
  it('leaves explicit hosts alone', () => {
    expect(resolveApiOrigin('https://api.example.com', dev)).toBe('https://api.example.com');
    expect(resolveApiOrigin('http://10.0.0.5:4000', dev)).toBe('http://10.0.0.5:4000');
  });
  it('is a no-op outside development', () => {
    expect(resolveApiOrigin('http://localhost:4000', { ...dev, dev: false })).toBe(
      'http://localhost:4000',
    );
  });
  it('is a no-op without a usable dev host (simulator on localhost)', () => {
    expect(
      resolveApiOrigin('http://localhost:4000', { dev: true, hostUri: 'localhost:8081' }),
    ).toBe('http://localhost:4000');
    expect(resolveApiOrigin('http://localhost:4000', { dev: true })).toBe('http://localhost:4000');
  });
});
