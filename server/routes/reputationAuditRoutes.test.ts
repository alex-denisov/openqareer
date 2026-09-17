import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from '../appTestHarness';

describe('reputation audit API routes', () => {
  it('возвращает 401 при запуске аудита без авторизации', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/reputation-audit/start',
      headers: {
        origin: 'http://localhost:3000',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('возвращает 403 при неразрешенном origin (CSRF защита)', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/reputation-audit/start',
      headers: {
        origin: 'http://evil-site.com',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });


  it('возвращает 401 при получении аудита без авторизации', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/reputation-audit',
    });
    expect(response.statusCode).toBe(401);
  });

  it('возвращает null до первого запуска аудита', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/reputation-audit',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.audit).toBeNull();
  });

  it('успешно запускает аудит и возвращает результат с сохранением', async () => {
    const app = await createApp();
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/reputation-audit/start',
      headers: {
        authorization: candidateAuthorization(app),
        origin: 'http://localhost:3000',
      },
      payload: {
        options: {
          experience: [
            {
              id: 'exp-1',
              company: 'VK',
              role: 'Tech Lead',
              startDate: '2021-01',
              endDate: '2023-01',
            },
          ],
          externalProfiles: [
            {
              platform: 'LinkedIn',
              company: 'VK',
              role: 'Junior Engineer',
              startDate: '2021-01',
              endDate: '2023-01',
            },
          ],
          publicPosts: [
            {
              id: 'post-1',
              sourcePlatform: 'Habr',
              content: 'Руководство компании — кидалы и самодуры',
            },
          ],
        },
      },
    });

    expect(startRes.statusCode).toBe(200);
    const startJson = startRes.json();
    expect(startJson.data.audit).toBeDefined();
    expect(startJson.data.audit.status).toBe('completed');
    expect(startJson.data.audit.overallStatus).toBe('critical_risk');
    expect(startJson.data.audit.consistencyDiscrepancies.length).toBeGreaterThan(0);
    expect(startJson.data.audit.reputationRisks.length).toBeGreaterThan(0);
    expect(startJson.data.audit.consentAction).toBe(
      'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
    );

    // Проверяем последующий GET
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/reputation-audit',
      headers: {
        authorization: candidateAuthorization(app),
      },
    });
    expect(getRes.statusCode).toBe(200);
    const getJson = getRes.json();
    expect(getJson.data.audit.id).toBe(startJson.data.audit.id);
  });
});
