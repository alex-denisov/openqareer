import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { FactRewriteRequest } from '../domain/experienceFactRewrite';
import type { FactRewriteVariantRequest } from '../domain/factRewriteVariant';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

const URL = '/api/v1/candidate/experience-fact-rewrite';
const KEY = 'e1#0';
const FIRST = 'Руководила группой бэкенда из 18 человек.';

async function harness(answers: (string | null)[]) {
  const rewriteVariant = vi.fn(async (_request: FactRewriteVariantRequest) => {
    const text = answers.shift();
    return text ? { text } : null;
  });
  const rewrite = async (request: FactRewriteRequest) => ({
    places: [{ experienceId: 'e1', bullets: [{ text: FIRST, sourceFactIds: [request.facts[0]!.id] }] }],
  });
  const { app, candidates } = await createApp([], { experienceFactRewriter: { rewrite, rewriteVariant } });
  const { cookie, candidateId } = await login(app);
  candidates.saveResumeDraft(candidateId, {
    ...EMPTY_RESUME_DRAFT,
    experience: [{
      id: 'e1', chronologyMemoryId: 'c1', title: 'Руководитель', employer: 'Сфера Платежи',
      startDate: '2018-01', current: true, bulletMemoryIds: [],
    }],
  }, []);
  candidates.addManualExperienceFact(candidateId, randomUUID(), 'Команда бэкенда была 18 человек');
  const call = (method: 'GET' | 'POST', url: string, payload?: object, origin = 'http://localhost:3000') =>
    app.inject({ method, url, headers: { cookie, origin }, ...(payload ? { payload } : {}) });
  const id = (await call('POST', URL)).json().data.proposal.id as string;
  const lines = () => {
    const { resume, memory } = candidates.getSnapshot(candidateId);
    return resume!.draft.experience[0]!.bulletMemoryIds.map((bullet) => memory.find((item) => item.id === bullet)!.statement);
  };
  return { call, id, lines, rewriteVariant, candidates, candidateId, variants: `${URL}/${id}/variants` };
}

describe('B786: варианты пункта резюме', () => {
  it('вариант хранится, в резюме не пишется; применяется выбранный', async () => {
    const { call, id, lines, variants, rewriteVariant } = await harness(['Вела бэкенд: 18 человек в группе.', 'Возглавляла бэкенд из 18 человек.']);
    const first = await call('POST', variants, { key: KEY, wish: { chips: ['shorter'] } });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ remaining: 2, variants: [{ text: 'Вела бэкенд: 18 человек в группе.' }] });
    await call('POST', variants, { key: KEY });
    expect(rewriteVariant.mock.calls[1]![0].avoid).toEqual([FIRST, 'Вела бэкенд: 18 человек в группе.']);
    expect(lines()).toEqual([]);

    const list = (await call('GET', `${variants}?key=${encodeURIComponent(KEY)}`)).json().data;
    expect(list.variants).toHaveLength(2);
    const unknown = await call('POST', `${URL}/${id}/apply`, { only: [KEY], variantId: randomUUID() });
    expect(unknown.statusCode).toBe(400);
    const applied = await call('POST', `${URL}/${id}/apply`, { only: [KEY], variantId: list.variants[0].id });
    expect(applied.statusCode).toBe(200);
    expect(lines()).toEqual(['Вела бэкенд: 18 человек в группе.']);
  });

  it('повтор и выдумка отклоняются и места не занимают', async () => {
    const { call, variants } = await harness([FIRST, 'Вела бэкенд из 30 человек.', null]);
    for (let step = 0; step < 3; step += 1) expect((await call('POST', variants, { key: KEY })).statusCode).toBe(503);
    expect((await call('GET', `${variants}?key=${encodeURIComponent(KEY)}`)).json().data).toEqual({ variants: [], remaining: 3 });
  });

  it('после трёх вариантов модель не зовётся, исходный пункт применяется', async () => {
    const { call, id, variants, rewriteVariant, lines } = await harness([
      'Вела бэкенд из 18 человек.', 'Возглавляла бэкенд из 18 человек.', 'Управляла бэкендом из 18 человек.',
    ]);
    for (let step = 0; step < 3; step += 1) expect((await call('POST', variants, { key: KEY })).statusCode).toBe(201);
    expect((await call('POST', variants, { key: KEY })).statusCode).toBe(409);
    expect(rewriteVariant).toHaveBeenCalledTimes(3);
    expect((await call('POST', `${URL}/${id}/apply`, { only: [KEY] })).statusCode).toBe(200);
    expect(lines()).toEqual([FIRST]);
  });

  it('чужой пункт, изменённые факты, плохое тело и чужой источник не проходят', async () => {
    const { call, variants, rewriteVariant, candidates, candidateId } = await harness([]);
    expect((await call('POST', variants, { key: 'e1#7' })).statusCode).toBe(409);
    expect((await call('POST', variants, { key: KEY, text: 'x' })).statusCode).toBe(400);
    expect((await call('GET', variants)).statusCode).toBe(400);
    expect((await call('POST', variants, { key: KEY }, 'https://evil.example')).statusCode).toBe(403);
    candidates.addManualExperienceFact(candidateId, randomUUID(), 'Внедрила дежурства');
    expect((await call('POST', variants, { key: KEY })).statusCode).toBe(409);
    expect(rewriteVariant).not.toHaveBeenCalled();
  });
});
