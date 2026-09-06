import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { config, noSessions, successProvider } from './appTestHarness';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';

const directories: string[] = [];
const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
      await writeFile(join(directory, name), content);
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

  it('поднимается, даже когда в сборке лежит собственный sitemap.xml', async () => {
    const app = await appWithStaticRoot({
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'sitemap.xml': '<?xml version="1.0"?><urlset></urlset>',
    });

    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

    expect(response.statusCode).toBe(200);
    // Живая карта побеждает файл сборки: в ней есть каталог, в файле — нет.
    expect(response.body).toContain('/vacancies');
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
