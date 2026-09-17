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

  it('возвращает пустой список контактов до запуска обогащения', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/vacancies/vac-empty/contacts',
    });
    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.contacts).toEqual([]);
  });

  it('успешно находит, сохраняет и возвращает контакты рекрутера для вакансии', async () => {
    const app = await createApp();
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

    expect(enrichRes.statusCode).toBe(200);
    const enrichJson = enrichRes.json();
    expect(enrichJson.data.contacts).toHaveLength(1);
    const contact = enrichJson.data.contacts[0];
    expect(contact.fullName).toBe('Анна Семенова');
    expect(contact.telegram).toBe('@anna_talent');
    expect(contact.phone).toBe('+7 (999) 000-11-22');

    // Проверяем получение сохранённых контактов через GET
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/vacancies/vac-123/contacts',
    });
    expect(getRes.statusCode).toBe(200);
    const getJson = getRes.json();
    expect(getJson.data.contacts).toHaveLength(1);
    expect(getJson.data.contacts[0].fullName).toBe('Анна Семенова');
  });
});
