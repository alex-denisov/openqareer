import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';

describe('search consent API routes (B263 срез 1)', () => {
  it('требует авторизацию для чтения согласия', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/search-consent',
    });
    expect(response.statusCode).toBe(401);
  });

  it('по умолчанию согласие не дано', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/search-consent',
      headers: { authorization: candidateAuthorization(app) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.consent.granted).toBe(false);
  });

  it('возвращает 403 при неразрешённом origin (CSRF)', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: { origin: 'http://malicious-site.com' },
      payload: { granted: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it('сохраняет решение кандидата с версией политики и датой', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { granted: true },
    });
    expect(response.statusCode).toBe(200);
    const consent = response.json().data.consent;
    expect(consent.granted).toBe(true);
    expect(consent.policyVersion).toBeTruthy();
    expect(consent.updatedAt).toBeTruthy();

    const readBack = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/search-consent',
      headers: { authorization: candidateAuthorization(app) },
    });
    expect(readBack.json().data.consent.granted).toBe(true);
  });

  it('отклоняет некорректное тело запроса', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: { granted: 'yes' },
    });
    expect(response.statusCode).toBe(400);
  });
});
