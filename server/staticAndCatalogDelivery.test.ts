import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { config, noSessions, successProvider } from './appTestHarness';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { resetCatalogSitemaps, setCatalogSitemaps } from './seo/catalogSitemapSchedule';
import { buildSitemapFiles } from './seo/sitemapXml';

const directories: string[] = [];
const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  resetCatalogSitemaps();
  vi.unstubAllEnvs();
});

/**
 * Раздача статики включена только в боевом режиме (`NODE_ENV=production`), и
 * ни один тест её не поднимал. Из-за этого не был виден отказ старта: плагин
 * статики регистрирует маршрут на каждый файл сборки, и файл `sitemap.xml`
 * столкнулся с живым маршрутом карты сайта — `FST_ERR_DUPLICATED_ROUTE`,
 * процесс не поднимается, выкат откатывается по проверке здоровья.
 * Найдено на локальном прогоне собранного сервера 2026-09-07 (B209).
 */
describe('B209: сервер поднимается с раздачей статики и живым каталогом', () => {
  async function appWithStaticRoot(files: Record<string, string>) {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-static-'));
    directories.push(directory);
    for (const [name, content] of Object.entries(files)) {
      const path = join(directory, name);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, content);
    }
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const app = await buildApp({
      config: { ...config, staticRoot: directory },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: true,
    });
    closers.push(async () => {
      await app.close();
      candidateStore.close();
    });
    return app;
  }

  it('B545: AEO routes override stale build files and do not receive immutable caching', async () => {
    const app = await appWithStaticRoot({
      'index.html': '<!doctype html><html><body>index</body></html>',
      'llms.txt': 'STALE AEO FILE',
      'llms-full.txt': 'STALE FULL AEO FILE',
    });
    for (const url of ['/llms.txt', '/llms-full.txt']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(response.body).toContain('## Срез пула');
      expect(response.body).not.toContain('STALE');
      expect(response.headers['cache-control']).toBe('public, max-age=300');
    }
  });

  it('маршруты карты перекрывают файлы сборки для индекса и дочерних карт', async () => {
    setCatalogSitemaps(buildSitemapFiles({ listings: [], jobs: [] }));
    const app = await appWithStaticRoot({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'sitemap.xml': 'STATIC SITEMAP FILE',
      'sitemaps/static-1.xml': 'STATIC CHILD SITEMAP FILE',
    });

    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    const child = await app.inject({ method: 'GET', url: '/sitemaps/static-1.xml' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<sitemapindex');
    expect(response.body).toContain('/sitemaps/static-1.xml');
    expect(response.body).not.toContain('STATIC SITEMAP FILE');
    expect(child.statusCode).toBe(200);
    expect(child.body).toContain('/legal/terms');
    expect(child.body).not.toContain('STATIC CHILD SITEMAP FILE');
  }, 20_000);

  it('keeps sitemap route names out of public and dist', () => {
    for (const root of [resolve('public'), resolve('dist')]) {
      if (root === resolve('dist') && !existsSync(root)) continue;
      expect(existsSync(join(root, 'sitemap.xml'))).toBe(false);
      expect(existsSync(join(root, 'sitemaps'))).toBe(false);
      expect(existsSync(join(root, 'sitemap-static.xml'))).toBe(false);
      expect(existsSync(join(root, 'sitemap-listings.xml'))).toBe(false);
    }
  });

  it('serves the IndexNow verification key only at its configured root path', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'a1b2c3d4e5f6a7b8');
    const app = await appWithStaticRoot({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
    });

    const response = await app.inject({ method: 'GET', url: '/a1b2c3d4e5f6a7b8.txt' });
    const wrongPath = await app.inject({ method: 'GET', url: '/a1b2c3d4e5f6a7b8' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('a1b2c3d4e5f6a7b8');
    expect(wrongPath.body).not.toContain('a1b2c3d4e5f6a7b8');
  });

  it('отдаёт публичный каталог и файлы сборки одновременно', async () => {
    const app = await appWithStaticRoot({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'robots.txt': 'User-agent: *\nAllow: /\n',
    });

    const catalog = await app.inject({ method: 'GET', url: '/vacancies' });
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.body).toContain('<!doctype html>');
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('User-agent');
  });
});
