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

describe('desktop Windows download (B576)', () => {
  it('serves the published installer beside the macOS image', async () => {
    const installer = Buffer.alloc(4096, 3);
    const app = createApp({
      'OpenQareer_1.0.9_x64-setup.exe': installer,
      'desktop-windows.json': manifest('OpenQareer_1.0.9_x64-setup.exe'),
    });
    const info = await app.inject({ method: 'GET', url: '/api/v1/desktop/windows' });
    expect(info.json().data).toMatchObject({
      available: true,
      version: '1.0.0',
      sizeBytes: 4096,
      architecture: 'x64',
      signed: false,
    });
    const file = await app.inject({ method: 'GET', url: '/downloads/openqareer-windows.exe' });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/vnd.microsoft.portable-executable');
    expect(file.headers['content-disposition']).toContain('OpenQareer_1.0.9_x64-setup.exe');
    expect(file.rawPayload.equals(installer)).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/desktop/macos' })).json().data.available,
    ).toBe(false);
  });

  it('never serves a macOS image or a foreign file as the Windows installer', async () => {
    const app = createApp({
      'OpenQareer_1.0.0_x64.dmg': 'image',
      'desktop-windows.json': manifest('OpenQareer_1.0.0_x64.dmg'),
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/desktop/windows' })).json().data,
    ).toEqual({
      available: false,
    });
    const file = await app.inject({ method: 'GET', url: '/downloads/openqareer-windows.exe' });
    expect(file.statusCode).toBe(404);
    expect(file.body).toBe('Сборка для Windows пока не опубликована.');
  });
});

describe('one desktop release for every client (B576)', () => {
  const COMMIT = 'a'.repeat(40);
  const release = (fileName: string, version = '1.1.4') =>
    JSON.stringify({ version, sha256: 'abc', fileName, commit: COMMIT });

  it('serves conventionally named installers and reports one version for both', async () => {
    const app = createApp({
      'OpenQareer-1.1.4-macos-universal.dmg': Buffer.alloc(64, 1),
      'OpenQareer-1.1.4-windows-x64-setup.exe': Buffer.alloc(32, 2),
      'desktop-macos.json': release('OpenQareer-1.1.4-macos-universal.dmg'),
      'desktop-windows.json': release('OpenQareer-1.1.4-windows-x64-setup.exe'),
    });
    const mac = await app.inject({ method: 'GET', url: '/downloads/openqareer-macos.dmg' });
    expect(mac.statusCode).toBe(200);
    expect(mac.headers['content-disposition']).toContain('OpenQareer-1.1.4-macos-universal.dmg');
    const windows = await app.inject({ method: 'GET', url: '/downloads/openqareer-windows.exe' });
    expect(windows.headers['content-disposition']).toContain('OpenQareer-1.1.4-windows-x64-setup.exe');

    const info = await app.inject({ method: 'GET', url: '/api/v1/desktop/release' });
    expect(info.headers['cache-control']).toBe('no-cache');
    expect(info.json().data).toEqual({ available: true, version: '1.1.4', commit: COMMIT });
    expect((await app.inject({ method: 'GET', url: '/api/v1/desktop/macos' })).json().data).toMatchObject({
      architecture: 'universal', version: '1.1.4',
    });
  });

  it('names no version while the two clients disagree or one is missing', async () => {
    const split = createApp({
      'OpenQareer-1.1.4-macos-universal.dmg': 'mac',
      'OpenQareer-1.1.3-windows-x64-setup.exe': 'win',
      'desktop-macos.json': release('OpenQareer-1.1.4-macos-universal.dmg'),
      'desktop-windows.json': release('OpenQareer-1.1.3-windows-x64-setup.exe', '1.1.3'),
    });
    expect((await split.inject({ method: 'GET', url: '/api/v1/desktop/release' })).json().data).toEqual({
      available: false,
    });
    const half = createApp({
      'OpenQareer-1.1.4-macos-universal.dmg': 'mac',
      'desktop-macos.json': release('OpenQareer-1.1.4-macos-universal.dmg'),
    });
    expect((await half.inject({ method: 'GET', url: '/api/v1/desktop/release' })).json().data).toEqual({
      available: false,
    });
  });
});

describe('desktop updater feed', () => {
  function createFeed(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'openqareer-desktop-feed-'));
    directories.push(root);
    mkdirSync(join(root, 'desktop'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'desktop', name), content);
    const app = Fastify();
    registerDesktopDownloadRoutes(app, { config: { databasePath: join(root, 'openqareer.db') } } as RouteDeps);
    return app;
  }

  it('serves the manifest uncached and the signed archives immutable', async () => {
    const app = createFeed({
      'latest.json': '{"version":"1.0.1"}',
      'OpenQareer_1.0.1_aarch64.app.tar.gz': 'archive',
      'OpenQareer_1.0.1_aarch64.app.tar.gz.sig': 'sig',
    });
    const manifest = await app.inject({ method: 'GET', url: '/desktop/latest.json' });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['cache-control']).toBe('no-cache');
    expect(manifest.json()).toEqual({ version: '1.0.1' });
    const archive = await app.inject({ method: 'GET', url: '/desktop/OpenQareer_1.0.1_aarch64.app.tar.gz' });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers['content-type']).toBe('application/gzip');
    expect(archive.body).toBe('archive');
    const signature = await app.inject({ method: 'GET', url: '/desktop/OpenQareer_1.0.1_aarch64.app.tar.gz.sig' });
    expect(signature.body).toBe('sig');
  });

  it('serves the universal Mac archive and the Windows installer as updates (B576)', async () => {
    const app = createFeed({
      'OpenQareer-1.1.4-macos-universal.app.tar.gz': 'mac',
      'OpenQareer-1.1.4-windows-x64-setup.exe': 'win',
      'OpenQareer-1.1.4-windows-x64-setup.exe.sig': 'sig',
    });
    const mac = await app.inject({ method: 'GET', url: '/desktop/OpenQareer-1.1.4-macos-universal.app.tar.gz' });
    expect(mac.headers['content-type']).toBe('application/gzip');
    const windows = await app.inject({ method: 'GET', url: '/desktop/OpenQareer-1.1.4-windows-x64-setup.exe' });
    expect(windows.statusCode).toBe(200);
    expect(windows.headers['content-type']).toBe('application/vnd.microsoft.portable-executable');
    const signature = await app.inject({ method: 'GET', url: '/desktop/OpenQareer-1.1.4-windows-x64-setup.exe.sig' });
    expect(signature.body).toBe('sig');
  });

  it('answers 404 for a missing feed and for names outside the feed', async () => {
    const app = createFeed({ 'notes.txt': 'secret' });
    for (const url of ['/desktop/latest.json', '/desktop/notes.txt', '/desktop/..%2Fopenqareer.db']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});
