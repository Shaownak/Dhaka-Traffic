import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { server } from './api';
import type { AddressInfo } from 'node:net';

let base: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('HTTP validation', () => {
  it.each(['/api/journey/plan', '/api/journey/parse', '/api/routes'])('rejects null JSON at %s', async path => {
    const response = await fetch(base + path, { method: 'POST', body: 'null' });
    expect(response.status).toBe(400);
  });

  it.each(['', '?lat=&lon=90.4', '?lat=91&lon=90.4', '?lat=23.8&lon=90.4&radiusKm=-1', '?lat=23.8&lon=90.4&radiusKm=Infinity', '?lat=23.8&lon=90.4&kind=hotel'])('rejects invalid place query %s', async query => {
    expect((await fetch(base + '/api/places/search' + query)).status).toBe(400);
  });

  it('validates dates on the raw route endpoint', async () => {
    const response = await fetch(base + '/api/routes', { method: 'POST', body: JSON.stringify({ origin: 'gulshan', destination: 'mirpur10', date: '2026-02-31' }) });
    expect(response.status).toBe(400);
  });

  it('still serves valid routes and health', async () => {
    expect((await fetch(base + '/api/health')).status).toBe(200);
    const response = await fetch(base + '/api/routes', { method: 'POST', body: JSON.stringify({ origin: 'gulshan', destination: 'mirpur10', date: '2026-09-08', departAt: 1055 }) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { routes: unknown[] }).routes.length).toBeGreaterThan(0);
  });
});
