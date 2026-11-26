import { describe, expect, it, vi } from 'vitest';
import type { FactRewriteVariantRequest } from '../domain/factRewriteVariant';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

const URL = '/api/v1/candidate/experience-fact-rewrite';
const PLACE = 'e-rosseti';
const KEY = `${PLACE}#0`;
const LINE = 'Руководил двумя направлениями из 250 специалистов.';
const REWORDED = 'Руководил двумя направлениями из 250 специалистов, рентабельность выросла до 40%.';
const VARIANT = 'Руководил двумя направлениями из 250 специалистов при рентабельности 40%.';

async function harness(answers: (string | null)[]) {
  const rewriteVariant = vi.fn(async (_request: FactRewriteVariantRequest) => {
    const text = answers.shift();
    return text ? { text } : null;
  });
  const rewrite = vi.fn(async () => null);
  const { app, candidates } = await createApp([], { experienceFactRewriter: { rewrite, rewriteVariant } });
  const { cookie, candidateId } = await login(app);
  candidates.saveResumeDraft(candidateId, {
    ...EMPTY_RESUME_DRAFT,
    experience: [{
      id: PLACE, chronologyMemoryId: 'c1', title: 'VP of Technology', employer: 'Россети Цифра',
      startDate: '2023-04', current: false, bulletMemoryIds: [],
    }],
  }, []);
  candidates.addManualExperienceFact(candidateId, 'line-1', LINE, PLACE);
  candidates.addManualExperienceFact(candidateId, 'line-2', 'Довёл рентабельность до 40%.', PLACE);
  candidates.addManualExperienceFact(candidateId, 'margin', 'Россети Цифра: рентабельность 40 %');
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie, origin: 'http://localhost:3000' }, ...(payload ? { payload } : {}) });
  const lines = () => {
    const { resume, memory } = candidates.getSnapshot(candidateId);
    return resume!.draft.experience[0]!.bulletMemoryIds.map((id) => memory.find((item) => item.id === id)!.statement);
  };
  const reword = () => call('POST', `${URL}/reword`, { experienceId: PLACE });
  return { call, lines, reword, rewriteVariant, rewrite, candidates, candidateId };
}

describe('B786: k06 переписывает строку места, когда новых фактов нет', () => {
  it('готовит правку один раз; «Другой вариант» даёт новый текст; «Применить» и «Отменить» меняют только эту строку', async () => {
    const { call, lines, reword, rewriteVariant, rewrite } = await harness([REWORDED, VARIANT]);
    const first = await reword();
    expect(first.statusCode).toBe(200);
    const { proposal, before } = first.json().data;
    expect(before).toBe(LINE);
    expect(proposal.places[0].bullets[0]).toMatchObject({ text: REWORDED, replacesMemoryId: 'line-1' });
    const asked = rewriteVariant.mock.calls[0]![0];
    expect(asked.current).toBe(LINE);
    expect(asked.facts.map((fact) => fact.statement)).toEqual([LINE, 'Россети Цифра: рентабельность 40 %']);
    expect((await reword()).json().data.proposal.id).toBe(proposal.id);
    expect(rewriteVariant).toHaveBeenCalledTimes(1);

    const variants = `${URL}/${proposal.id}/variants`;
    const made = await call('POST', variants, { key: KEY });
    expect(made.statusCode).toBe(201);
    const variant = made.json().data.variants[0];
    expect(variant.text).toBe(VARIANT);
    expect(rewriteVariant.mock.calls[1]![0].avoid).toEqual([REWORDED]);
    expect(lines()).toEqual([LINE, 'Довёл рентабельность до 40%.']);

    const applied = await call('POST', `${URL}/${proposal.id}/apply`, { only: [KEY], variantId: variant.id });
    expect(applied.statusCode).toBe(200);
    expect(lines()).toEqual([VARIANT, 'Довёл рентабельность до 40%.']);
    const reverted = await call('POST', `${URL}/${applied.json().data.rewrite.id}/revert`);
    expect(reverted.statusCode).toBe(200);
    expect(lines()).toEqual([LINE, 'Довёл рентабельность до 40%.']);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('модель не ответила — 502 с понятным текстом, резюме не тронуто', async () => {
    const { reword, lines, candidates, candidateId } = await harness([null]);
    const failed = await reword();
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toMatchObject({ code: 'reword_failed', retryable: true });
    expect(lines()).toEqual([LINE, 'Довёл рентабельность до 40%.']);
    expect(candidates.getSnapshot(candidateId).resume!.draft.factRewordProposal).toBeUndefined();
  });

  it('выдуманное число (80 % вместо 40 %) не проходит в правку', async () => {
    const { reword } = await harness(['Руководил двумя направлениями из 250 специалистов, рентабельность 80%.', null]);
    expect((await reword()).statusCode).toBe(502);
  });

  it('места нет — правки нет', async () => {
    const { call } = await harness([REWORDED]);
    const none = await call('POST', `${URL}/reword`, { experienceId: 'missing' });
    expect([none.statusCode, none.json().data.proposal]).toEqual([200, null]);
  });
});
