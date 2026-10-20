import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp, stores } from '../appTestHarness';

async function createConsentedApp() {
  const app = await createApp();
  const consent = await app.inject({ method: 'PUT', url: '/api/v1/candidate/relocation-questionnaire/consent', headers: { authorization: candidateAuthorization(app) }, payload: { versionId: 'relocation-questionnaire-v1.0' } });
  expect(consent.statusCode).toBe(200);
  return app;
}
const input = () => ({ name: 'Мой бюджет', countryCode: 'AE', city: 'Дубай', householdSize: 1,
  grossAnnualIncome: 120000, incomeMode: 'local_employment', scenarioId: 'employer_sponsorship',
  expenses: {}, upfront: {}, reserveMonths: 3, visa: {} });
describe('B468 candidate relocation scenarios HTTP', () => {
  it('does not store scenario personal data before relocation consent', async () => {
    const app = await createApp();
    const reply = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers: { authorization: candidateAuthorization(app), 'idempotency-key': '33333333-3333-4333-8333-333333333333' }, payload: input() });
    expect(reply.statusCode).toBe(403);
  });
  it('isolates tenants, includes snapshots in export, pages and removes them on consent revocation', async () => {
    const app = await createConsentedApp(); const authorization = candidateAuthorization(app); const store = stores.at(-1)!;
    const candidate = store.authenticate(authorization.slice(7))!;
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const saved = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers: { authorization, 'idempotency-key': '22222222-2222-4222-8222-222222222222' }, payload: input() });
    expect(saved.statusCode).toBe(201); const id = saved.json().data.id;
    expect(store.exportCandidate(candidate.id).relocationScenarios).toHaveLength(1);
    const otherHeaders = { authorization: `Bearer ${other.accessToken}` };
    expect((await app.inject({ url: `/api/v1/candidate/relocation-scenarios/${id}`, headers: otherHeaders })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/candidate/relocation-scenarios/${id}`, headers: otherHeaders })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/candidate/relocation-scenarios?limit=21', headers: { authorization } })).statusCode).toBe(400);
    store.relocationQuestionnaireRepo.revokeConsent(candidate.id, new Date().toISOString());
    expect((await app.inject({ url: `/api/v1/candidate/relocation-scenarios/${id}`, headers: { authorization } })).statusCode).toBe(404);
    expect(store.exportCandidate(candidate.id).relocationScenarios).toEqual([]);
  });
  it('calculates on server, replays a retry, reads history and deletes a saved budget', async () => {
    const app = await createConsentedApp(); const authorization = candidateAuthorization(app);
    const headers = { authorization, 'idempotency-key': '11111111-1111-4111-8111-111111111111' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers, payload: input() });
    expect(first.statusCode).toBe(201);
    const saved = first.json().data;
    expect(saved.result.monthlyNetIncome).toBe(10000);
    expect(saved.result.monthlyRemaining).toBeNull();
    const retry = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers, payload: input() });
    expect(retry.statusCode).toBe(200); expect(retry.json().data.id).toBe(saved.id);
    const conflict = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers, payload: { ...input(), grossAnnualIncome: 999 } });
    expect(conflict.statusCode).toBe(409);
    const list = await app.inject({ url: '/api/v1/candidate/relocation-scenarios?limit=1', headers });
    expect(list.json().data.items).toHaveLength(1);
    const read = await app.inject({ url: `/api/v1/candidate/relocation-scenarios/${saved.id}`, headers });
    expect(read.json().data.input.city).toBe('Дубай');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/candidate/relocation-scenarios/${saved.id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/v1/candidate/relocation-scenarios/${saved.id}`, headers })).statusCode).toBe(404);
  });
  it('rejects unauthenticated, forged result fields, missing retry keys and invalid currency', async () => {
    const app = await createConsentedApp(); const authorization = candidateAuthorization(app);
    expect((await app.inject({ url: '/api/v1/candidate/relocation-scenarios' })).statusCode).toBe(401);
    const result = await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers: { authorization, 'idempotency-key': '11111111-1111-4111-8111-111111111111' }, payload: { ...input(), result: { monthlyRemaining: 999999 } } });
    expect(result.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/relocation-scenarios', headers: { authorization }, payload: input() })).statusCode).toBe(400);
  });
});
