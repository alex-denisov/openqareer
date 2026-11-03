import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulletTranslationRequest } from './domain/experienceBulletLanguage';
import { clearLetterFactTranslationCache, translateLetterFacts } from './domain/letterFactTranslation';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import type { VacancyCluster } from './domain/unifiedVacancy';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

// G3b item 2 on the route: the Russian outcome bullet of a workplace reaches
// the English letter translated, the employer stays in its own script.
const leidos: VacancyCluster = {
  id: 'cluster-leidos',
  canonicalTitle: 'Director, Technology Operations & Sustainment',
  canonicalCompany: 'Leidos',
  canonicalLocation: 'Reston, VA',
  isRemote: false,
  descriptionSummary: 'Leidos is seeking a Director to lead technology operations and sustainment.',
  skills: ['ITIL'],
  primaryUrl: 'https://example.com/leidos',
  sources: [],
  firstObservedAt: '2026-11-03T00:00:00.000Z',
  lastSeenAt: '2026-11-03T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};
const OUTCOME = 'Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.';
const OUTCOME_EN = 'Built warehouse and logistics systems for a federal retail chain; the team grew from 8 to 35.';

function translator(answer: (request: BulletTranslationRequest) => string) {
  return {
    rewrite: async () => null,
    translate: vi.fn(async (request: BulletTranslationRequest) => ({
      bullets: request.bullets.map((bullet) => ({ key: bullet.key, text: answer(request) })),
    })),
  };
}

async function letterFor(rewriter: ReturnType<typeof translator>) {
  const { app, candidates } = await createApp([leidos], { experienceFactRewriter: rewriter });
  const { cookie, candidateId } = await login(app);
  candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'synthetic',
    entries: [
      { memoryId: 'exp-3', domain: 'role-evidence', statement: 'Ритейл Системс, Москва — Руководитель разработки (2014-03 — 2021-01)' },
      { memoryId: 'ach-3-1', domain: 'outcome', statement: OUTCOME },
    ],
  });
  candidates.reviewMemories(candidateId, ['exp-3', 'ach-3-1'], 'confirm');
  candidates.saveResumeDraft(
    candidateId,
    {
      ...EMPTY_RESUME_DRAFT,
      experience: [{
        id: 'w3', chronologyMemoryId: 'exp-3', bulletMemoryIds: ['ach-3-1'],
        title: 'Руководитель разработки', employer: 'Ритейл Системс',
        startDate: '2014-03', endDate: '2021-01', current: false,
      }],
    },
    [],
  );
  const response = await app.inject({
    method: 'POST', url: '/api/v1/candidate/vacancies/cluster-leidos/pitch',
    headers: { cookie, origin: 'http://localhost:3000' }, payload: {},
  });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

beforeEach(() => clearLetterFactTranslationCache());

describe('G3b: results of the places in the English letter', () => {
  it('quotes the translated outcome and keeps the employer as written', async () => {
    const data = await letterFor(translator(() => OUTCOME_EN));
    expect(data.language).toBe('en');
    expect(data.emailPitch.body).toContain(`Among my results: ${OUTCOME_EN}`);
    expect(data.emailPitch.body).toContain('Most recently I worked as Head of Engineering at "Ритейл Системс" (2014–2021).');
    expect(data.usedEvidenceIds).toContain('ach-3-1');
    expect(data.outputFactChecks.emailBody.status).not.toBe('needs_confirmation');
  });

  it('a translation that invents a number is dropped, the letter has no result', async () => {
    const data = await letterFor(translator(() => 'Built logistics for a federal retail chain; the team grew from 8 to 50.'));
    expect(data.emailPitch.body).not.toContain('Among my results');
    expect(data.emailPitch.body).not.toContain('50');
  });
});

describe('translateLetterFacts', () => {
  const fact = { id: 'ach-3-1', statement: OUTCOME, domain: 'outcome' };

  it('remembers a checked translation and does not ask again', async () => {
    const rewriter = translator(() => OUTCOME_EN);
    expect(await translateLetterFacts(rewriter, [fact], 1_000)).toEqual(new Map([['ach-3-1', OUTCOME_EN]]));
    await translateLetterFacts(rewriter, [{ ...fact, id: 'same-text' }], 1_000);
    expect(rewriter.translate).toHaveBeenCalledTimes(1);
  });

  it('gives up after the budget instead of holding the letter', async () => {
    const slow = { translate: () => new Promise<null>(() => undefined) };
    expect(await translateLetterFacts(slow, [fact], 20)).toEqual(new Map());
  });

  it('a late answer is remembered for the next letter', async () => {
    let answer: (value: { bullets: { key: string; text: string }[] }) => void = () => undefined;
    const late = { translate: () => new Promise<{ bullets: { key: string; text: string }[] }>((resolve) => { answer = resolve; }) };
    expect(await translateLetterFacts(late, [fact], 20)).toEqual(new Map());
    answer({ bullets: [{ key: 'ach-3-1', text: OUTCOME_EN }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await translateLetterFacts(undefined, [fact], 20)).toEqual(new Map([['ach-3-1', OUTCOME_EN]]));
  });

  it('a failing translator leaves the letter without a result', async () => {
    const failing = { translate: async () => { throw new Error('provider down'); } };
    expect(await translateLetterFacts(failing, [fact], 1_000)).toEqual(new Map());
  });

  it('an answer still in Russian is not a translation', async () => {
    expect(await translateLetterFacts(translator(() => OUTCOME), [fact], 1_000)).toEqual(new Map());
  });
});
