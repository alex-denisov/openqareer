import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDesktopDownloadRoutes } from './routes/desktopDownloadRoutes';
import type { RouteDeps } from './routes/deps';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createApp(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), 'openqareer-desktop-dl-'));
  directories.push(root);
  mkdirSync(join(root, 'downloads'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'downloads', name), content);
  const app = Fastify();
  registerDesktopDownloadRoutes(app, { config: { databasePath: join(root, 'openqareer.db') } } as RouteDeps);
  return app;
}

const manifest = (fileName: string) =>
  JSON.stringify({ version: '1.0.0', sha256: 'abc', fileName });

describe('desktop macOS download', () => {
  it('reports version and the real file size, and serves the image', async () => {
    const image = Buffer.alloc(2048, 7);
    const app = createApp({
      'OpenQareer_1.0.0_x64.dmg': image,
      'desktop-macos.json': manifest('OpenQareer_1.0.0_x64.dmg'),
    });
    const info = await app.inject({ method: 'GET', url: '/api/v1/desktop/macos' });
    expect(info.json().data).toMatchObject({
      available: true, version: '1.0.0', sizeBytes: 2048, architecture: 'x64', signed: false,
    });
    expect(info.json().data.path).toBeUndefined();

    const file = await app.inject({ method: 'GET', url: '/downloads/openqareer-macos.dmg' });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toContain('OpenQareer_1.0.0_x64.dmg');
    expect(file.headers['content-length']).toBe('2048');
    expect(file.rawPayload.equals(image)).toBe(true);
  });

  it('says unavailable when nothing is published or the manifest names a bad file', async () => {
    const empty = createApp({});
    expect((await empty.inject({ method: 'GET', url: '/api/v1/desktop/macos' })).json().data).toEqual({
      available: false,
    });
    expect((await empty.inject({ method: 'GET', url: '/downloads/openqareer-macos.dmg' })).statusCode).toBe(404);

    const traversal = createApp({ 'desktop-macos.json': manifest('../openqareer.db') });
    expect((await traversal.inject({ method: 'GET', url: '/api/v1/desktop/macos' })).json().data.available).toBe(false);
  });
});
