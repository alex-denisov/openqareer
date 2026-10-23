import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAeoRoutes } from './aeoRoutes';
import { resetLandingStats, setLandingStats } from '../landing/landingStatsCache';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  resetLandingStats();
});

describe('B545: live AEO evidence routes', () => {
  it('serves a fresh aggregate snapshot with short cache, without private vacancy payloads', async () => {
    setLandingStats({ activeCount: 123, remoteCount: 45, sourceCount: 6, updatedAt: '2026-10-23',
      vacancies: [{ title: 'PRIVATE VACANCY PAYLOAD', salary: '123', country: 'country' }] });
    const app = Fastify();
    apps.push(app);
    registerAeoRoutes(app);
    for (const url of ['/llms.txt', '/llms-full.txt']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.body).toContain('123');
      expect(response.body).toContain('2026-10-23');
      expect(response.body).not.toContain('PRIVATE VACANCY PAYLOAD');
      const head = await app.inject({ method: 'HEAD', url });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
    }
    setLandingStats({ activeCount: 456, remoteCount: 45, sourceCount: 6, updatedAt: '2026-10-24',
      vacancies: [{ title: 'private', salary: '123', country: 'country' }] });
    expect((await app.inject('/llms.txt')).body).toContain('456');
    expect((await app.inject('/llms.txt')).body).toContain('2026-10-24');
  });
});
