import { describe, expect, it } from 'vitest';
import { createApp, config, noSessions, successProvider } from './appTestHarness';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import type { UnifiedVacancy } from './domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './vacancies/memoryVacancyPoolStore';

function vacancy(index: number, overrides: Partial<UnifiedVacancy> = {}): UnifiedVacancy {
  return {
    id: `v${index}`,
    fingerprint: `f${index}`,
    title: 'Frontend Developer',
    // Разные работодатели: одинаковые слились бы в один кластер, и список не
    // набрал бы порога публикации.
    company:
      ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay'][index] ?? `Company ${index}`,
    location: 'Berlin',
    isRemote: false,
    description: `Полное описание вакансии номер ${index}. `.repeat(20),
    requiredSkills: ['React'],
    url: `https://boards.example.com/job/${index}`,
    provenance: {
      sourceType: 'json_api',
      // Площадка должна быть в реестре: восстановление пула намеренно
      // выбрасывает записи источника, которого продукт не знает.
      sourceId: 'src-himalayas',
      sourceUrl: `https://boards.example.com/job/${index}`,
      observedAt: '2026-09-07T00:00:00.000Z',
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
    ...overrides,
  };
}

/**
 * Каталог, который нельзя открыть без входа, — не каталог: поисковик его не
 * увидит. Поэтому маршруты проверяются без единой куки.
 */
/**
 * Пул тестового приложения пуст, поэтому ни один список не проходит порог
 * публикации. Чтобы проверялась не только ветка отказа, приложение поднимается
 * с движком, чей пул уже наполнен.
 */
async function appWithPool(vacancies: readonly UnifiedVacancy[]) {
  const pool = new MemoryVacancyPoolStore();
  for (const sourceId of new Set(vacancies.map((v) => v.provenance.sourceId))) {
    pool.replaceSourceSlice(
      sourceId,
      vacancies.filter((v) => v.provenance.sourceId === sourceId),
    );
  }
  const engine = new MultiSourceVacancyEngine({ pool });
  engine.restore();
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  return buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    multiSourceVacancyEngine: engine,
  });
}

describe('B209: публичный каталог вакансий', () => {
  it('отдаёт каталог без сессии цельным HTML-документом', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/vacancies' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body.startsWith('<!doctype html>')).toBe(true);
    expect(response.body).toContain(
      '<link rel="canonical" href="https://openqareer.com/vacancies">',
    );
    expect(response.body).toContain('"@type":"ItemList"');
  });

  it('отдаёт страницу каталога по номеру', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/vacancies/page/2' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<!doctype html>');
  });

  /**
   * Пропавшая вакансия обязана отвечать `410`: только по нему поисковик
   * выбрасывает адрес из индекса сразу, а не копит мёртвые ссылки на домене.
   */
  it('отвечает 410 на вакансию, которой в пуле больше нет', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/vacancies/job/data-analyst-at-acme-zzzzzz',
    });
    expect(response.statusCode).toBe(410);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('отдаёт живую карту сайта, а не файл сборки', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.body).toContain('<loc>https://openqareer.com/vacancies</loc>');
    expect(response.body).toContain('<loc>https://openqareer.com/legal/terms</loc>');
  });

  it('сводит нечисловую и отрицательную страницу к первой, а не падает', async () => {
    const app = await createApp();
    for (const url of ['/vacancies/page/abc', '/vacancies/page/-2', '/vacancies/page/0']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body).toContain(
        '<link rel="canonical" href="https://openqareer.com/vacancies">',
      );
    }
  });

  it('отвечает 410 и на адрес карточки без ключа', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/vacancies/job/x' });
    expect(response.statusCode).toBe(410);
  });

  /**
   * Срез 2b: список по месту и роли. Пул тестового приложения пуст, поэтому
   * ни один список не проходит порог публикации — и это должно отвечать `410`,
   * а не пустой страницей: адрес, который мы сами не печатаем, обязан уйти из
   * индекса, а не копиться на домене.
   */
  it('отвечает 410 на список, который не проходит порог публикации', async () => {
    const app = await createApp();
    for (const url of [
      '/vacancies/moscow',
      '/vacancies/remote/frontend-developer',
      '/vacancies/moscow/page/2',
      '/vacancies/remote/frontend-developer/page/2',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(410);
      expect(response.body, url).toContain('Этой вакансии больше нет');
    }
  });

  it('служебные пути каталога не путаются со списком', async () => {
    const app = await createApp();
    const page = await app.inject({ method: 'GET', url: '/vacancies/page/2' });
    const job = await app.inject({ method: 'GET', url: '/vacancies/job/data-analyst-x' });
    expect(page.statusCode).toBe(200);
    expect(job.statusCode).toBe(410);
  });

  /**
   * Списки на живом пуле: без наполнения ни один список не проходит порог, и
   * проверялась бы только ветка отказа.
   */
  it('отдаёт список по месту и роли, когда порог публикации пройден', async () => {
    const app = await appWithPool(Array.from({ length: 5 }, (_, index) => vacancy(index)));

    const place = await app.inject({ method: 'GET', url: '/vacancies/berlin' });
    const role = await app.inject({ method: 'GET', url: '/vacancies/berlin/frontend-developer' });

    expect(place.statusCode).toBe(200);
    expect(place.body).toContain('<h1>Вакансии — Berlin</h1>');
    expect(role.statusCode).toBe(200);
    expect(role.body).toContain('<h1>Frontend Developer — вакансии, Berlin</h1>');
    expect(role.body).toContain('"@type":"ItemList"');
  });

  it('печатает фильтры группами на корне каталога', async () => {
    const app = await appWithPool(Array.from({ length: 5 }, (_, index) => vacancy(index)));
    const response = await app.inject({ method: 'GET', url: '/vacancies' });
    expect(response.body).toContain('Сузить выборку');
    // Место и роль названы порознь: в плоском списке читатель не видел, что из
    // этого город, а что должность (B209, срез 2b).
    expect(response.body).toContain('<h3>Места</h3>');
    expect(response.body).toContain('<h3>Роли</h3>');
    expect(response.body).toContain('href="/vacancies/berlin"');
    expect(response.body).toContain('href="/vacancies/berlin/frontend-developer"');
  });

  it('на странице списка предлагает уйти в другое место, а не только остаться', async () => {
    const app = await appWithPool([
      ...Array.from({ length: 4 }, (_, index) => vacancy(index)),
      ...Array.from({ length: 3 }, (_, index) => vacancy(index + 10, { location: 'Amsterdam' })),
    ]);
    const response = await app.inject({ method: 'GET', url: '/vacancies/berlin' });
    expect(response.statusCode).toBe(200);
    // Фильтры считаются по всему каталогу: иначе со страницы места уйти было бы
    // некуда — других мест в выбранных записях нет по определению.
    expect(response.body).toContain('href="/vacancies/amsterdam"');
    expect(response.body).not.toContain('href="/vacancies/berlin"');
  });

  it('кладёт списки в карту сайта рядом с вакансиями', async () => {
    const app = await appWithPool(Array.from({ length: 5 }, (_, index) => vacancy(index)));
    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(response.body).toContain('<loc>https://openqareer.com/vacancies/berlin</loc>');
    expect(response.body).toContain(
      '<loc>https://openqareer.com/vacancies/berlin/frontend-developer</loc>',
    );
  });

  it('показывает полный текст вакансии и его же в разметке', async () => {
    const app = await appWithPool([vacancy(1)]);
    const catalog = await app.inject({ method: 'GET', url: '/vacancies' });
    const href = /href="(\/vacancies\/job\/[^"]+)"/u.exec(catalog.body)?.[1];
    expect(href).toBeTruthy();

    const detail = await app.inject({ method: 'GET', url: href! });
    expect(detail.statusCode).toBe(200);
    // Сводка кластера — 300 знаков; полный текст длиннее, и он должен быть и на
    // странице, и в разметке одним значением.
    expect(detail.body).toContain('описание вакансии номер 1');
    const description = /"description":"([^"]+)"/u.exec(detail.body)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(300);
  });
});
