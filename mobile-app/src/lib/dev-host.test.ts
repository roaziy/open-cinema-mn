import { describe, expect, it } from 'vitest';
import { devMediaUrl, hostFromHostUri, resolveApiOrigin } from './dev-host';

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
    expect(resolveApiOrigin('http://localhost:8080', dev)).toBe('http://192.168.1.197:8080');
    expect(resolveApiOrigin('http://127.0.0.1:8080', dev)).toBe('http://192.168.1.197:8080');
    expect(resolveApiOrigin('http://[::1]:8080', dev)).toBe('http://192.168.1.197:8080');
  });
  it('keeps a base path', () => {
    expect(resolveApiOrigin('http://localhost:8080/api', dev)).toBe(
      'http://192.168.1.197:8080/api',
    );
  });
  it('leaves explicit hosts alone', () => {
    expect(resolveApiOrigin('https://api.example.com', dev)).toBe('https://api.example.com');
    expect(resolveApiOrigin('http://10.0.0.5:8080', dev)).toBe('http://10.0.0.5:8080');
  });
  it('is a no-op outside development', () => {
    expect(resolveApiOrigin('http://localhost:8080', { ...dev, dev: false })).toBe(
      'http://localhost:8080',
    );
  });
  it('is a no-op without a usable dev host (simulator on localhost)', () => {
    expect(
      resolveApiOrigin('http://localhost:8080', { dev: true, hostUri: 'localhost:8081' }),
    ).toBe('http://localhost:8080');
    expect(resolveApiOrigin('http://localhost:8080', { dev: true })).toBe('http://localhost:8080');
  });
});

describe('devMediaUrl', () => {
  it('points loopback media at the LAN host, keeping port, path and query', () => {
    expect(devMediaUrl('http://localhost:8080/media/p.jpg?v=2', dev)).toBe(
      'http://192.168.1.197:8080/media/p.jpg?v=2',
    );
    expect(devMediaUrl('http://127.0.0.1:8080/media/p.jpg', dev)).toBe(
      'http://192.168.1.197:8080/media/p.jpg',
    );
  });
  it('leaves real hosts, production, bad input and a missing host alone', () => {
    expect(devMediaUrl('https://cdn.example.com/p.jpg', dev)).toBe('https://cdn.example.com/p.jpg');
    expect(
      devMediaUrl('http://localhost:8080/p.jpg', { dev: false, hostUri: '10.0.0.2:8081' }),
    ).toBe('http://localhost:8080/p.jpg');
    expect(devMediaUrl('not a url', dev)).toBe('not a url');
    expect(devMediaUrl('http://localhost:8080/p.jpg', { dev: true, hostUri: undefined })).toBe(
      'http://localhost:8080/p.jpg',
    );
  });
});
