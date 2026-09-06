import { describe, expect, it } from 'vitest';
import { createApp } from './appTestHarness';

/**
 * Каталог, который нельзя открыть без входа, — не каталог: поисковик его не
 * увидит. Поэтому маршруты проверяются без единой куки.
 */
describe('B209: публичный каталог вакансий', () => {
  it('отдаёт каталог без сессии цельным HTML-документом', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/vacancies' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body.startsWith('<!doctype html>')).toBe(true);
    expect(response.body).toContain('<link rel="canonical" href="https://openqareer.com/vacancies">');
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
      expect(response.body).toContain('<link rel="canonical" href="https://openqareer.com/vacancies">');
    }
  });

  it('отвечает 410 и на адрес карточки без ключа', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/vacancies/job/x' });
    expect(response.statusCode).toBe(410);
  });
});
