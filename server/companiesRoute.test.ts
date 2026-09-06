import { describe, expect, it } from 'vitest';
import { createApp } from './appTestHarness';

describe('B201: Companies API Routes (/api/v1/companies)', () => {
  it('GET /api/v1/companies returns list of companies and registry stats', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(600);
    expect(body.count).toBe(10);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(10);
    expect(body.stats).toBeDefined();
    expect(body.stats.totalCompanies).toBeGreaterThan(600);

    const first = body.items[0];
    expect(first.id).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.attributes).toBeInstanceOf(Array);
  });

  it('GET /api/v1/companies supports facet filtering (relocation=true)', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?relocation=true&limit=5',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(100);
    expect(body.items).toHaveLength(5);
    for (const item of body.items) {
      const hasReloc = item.attributes.some((a: { key: string }) => a.key === 'relocation');
      expect(hasReloc).toBe(true);
    }
  });

  it('GET /api/v1/companies supports currency_remote, ru_abroad, country and has_ats filters', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?currency_remote=true&ru_abroad=false&full_remote=false&country=Нидерланды&city=Амстердам&has_ats=true&has_vacancies=false&limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(10);
    expect(body.items).toBeInstanceOf(Array);
  });

  it('GET /api/v1/companies supports search by name', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?search=miro',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(0);
    const miro = body.items.find((c: { name: string }) => c.name.toLowerCase() === 'miro');
    expect(miro).toBeDefined();
    expect(miro.domain).toBe('miro.com');
  });

  it('GET /api/v1/companies returns 400 on invalid query params', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?relocation=invalid_bool',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('invalid_query_parameters');
  });

  it('GET /api/v1/companies/stats returns aggregate stats', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/stats',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stats.totalCompanies).toBeGreaterThan(600);
    expect(body.stats.withRelocation).toBeGreaterThan(100);
    expect(body.stats.withCurrencyRemote).toBeGreaterThan(150);
  });

  it('GET /api/v1/companies/:id returns single company with claims', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/comp-miro',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.company.name).toBe('Miro');
    expect(body.company.domain).toBe('miro.com');
    expect(body.company.atsProvider).toBe('ashby');
  });

  it('GET /api/v1/companies/:id returns 404 for non-existent company', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/comp-non-existent-xyz-99',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('company_not_found');
  });
});
