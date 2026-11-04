import { describe, expect, it, vi } from 'vitest';
import type { VacancyCluster } from './domain/unifiedVacancy';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

// G3c: POST /pitch answered 503 storage_busy while the pool was being refreshed.
const cluster: VacancyCluster = {
  id: 'cluster-busy',
  canonicalTitle: 'VP Operations',
  canonicalCompany: 'Bjak',
  canonicalLocation: 'Remote',
  isRemote: true,
  descriptionSummary: 'Operations',
  skills: [],
  primaryUrl: 'https://example.com/busy',
  sources: [],
  firstObservedAt: '2026-11-03T00:00:00.000Z',
  lastSeenAt: '2026-11-03T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};
const busy = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
const url = '/api/v1/candidate/vacancies/cluster-busy/pitch';

describe('POST /pitch while the database is busy', () => {
  it('a lock on the candidate snapshot is waited out, the writer is asked once', async () => {
    const writeCoverLetter = vi.fn(async () => ({ body: 'Здравствуйте! Буду рад обсудить задачи роли.', stage: 'test' }));
    const { app, candidates } = await createApp([cluster], { coverLetterWriter: { writeCoverLetter } });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'imp0123456789-a', domain: 'outcome', statement: 'Команда выросла с 8 до 35 человек.' }],
    });
    vi.spyOn(candidates, 'getSnapshot').mockImplementationOnce(() => { throw busy(); });
    const response = await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'ru' } });
    expect(response.statusCode).toBe(200);
    expect(writeCoverLetter).toHaveBeenCalledTimes(1);
  });

  it('a lock while saving the letter does not lose the letter or ask the model again', async () => {
    const writeCoverLetter = vi.fn(async () => ({ body: 'Здравствуйте! Буду рад обсудить задачи роли.', stage: 'test' }));
    const { app, candidates } = await createApp([cluster], { coverLetterWriter: { writeCoverLetter } });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'imp0123456789-a', domain: 'outcome', statement: 'Команда выросла с 8 до 35 человек.' }],
    });
    const application = candidates.createApplication(candidateId, {
      stage: 'saved',
      manualVacancy: { title: 'VP Operations', company: 'Bjak', url: 'https://example.com/busy', source: 'remotive' },
    });
    vi.spyOn(candidates, 'saveDocumentAndLinkApplicationMaterial').mockImplementationOnce(() => { throw busy(); });
    const response = await app.inject({
      method: 'POST', url, headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'ru', applicationId: application.id },
    });
    expect(response.statusCode).toBe(200);
    expect(writeCoverLetter).toHaveBeenCalledTimes(1);
    expect(candidates.getSnapshot(candidateId).documents.some((doc) => doc.kind === 'cover_letter')).toBe(true);
  });

  it('a lock on the session is waited out too', async () => {
    const { app, candidates } = await createApp([cluster]);
    const { cookie } = await login(app);
    vi.spyOn(candidates, 'authenticate').mockImplementationOnce(() => { throw busy(); });
    const response = await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'ru' } });
    expect(response.statusCode).toBe(200);
  });

  it('a refusal before the model stays what it was', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/nobody/pitch', headers: { cookie, origin: 'http://localhost:3000' }, payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('vacancy_not_found');
  });
});
