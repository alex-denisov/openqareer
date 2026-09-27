import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';

describe('recruiter intelligence API routes', () => {
  it('возвращает 401 при попытке обогащения без авторизации кандидата', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/vac-1/enrich-contacts',
      headers: {
        origin: 'http://localhost:3000',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('возвращает 403 при неразрешённом origin (CSRF)', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/vac-1/enrich-contacts',
      headers: {
        origin: 'http://malicious-site.com',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('требует авторизацию для чтения контактов', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vacancies/vac-empty/contacts',
    });
    expect(response.statusCode).toBe(401);
  });

  it('возвращает 403 без согласия «Вы в поиске» даже для авторизованного кандидата', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/vac-1/enrich-contacts',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('search_consent_required');
  });

  it('после отзыва согласия (PUT { granted: false }) поиск контактов снова возвращает 403 search_consent_required', async () => {
    const app = await createApp();
    const grantRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { granted: true },
    });
    expect(grantRes.statusCode).toBe(200);

    const revokeRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { granted: false },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().data.consent.granted).toBe(false);

    const enrichRes = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/vac-1/enrich-contacts',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: {},
    });
    expect(enrichRes.statusCode).toBe(403);
    expect(enrichRes.json().error.code).toBe('search_consent_required');
  });

  it('не принимает пользовательский текст вместо канонической вакансии', async () => {
    const app = await createApp();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { granted: true },
    });
    const enrichRes = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/vac-123/enrich-contacts',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: {
        vacancy: {
          id: 'vac-123',
          company: 'Acme International',
          url: 'https://careers.acme-corp.com/jobs/123',
          description: `
            Команда продукта ищет инженера.
            Контакты для связи:
            Рекрутер: Анна Семенова
            Telegram: @anna_talent
            Почта: a.semenova@acme-corp.com
            Телефон: +7 (999) 000-11-22
          `,
        },
      },
    });

    expect(enrichRes.statusCode).toBe(404);
  });
});
