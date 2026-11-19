import { describe, expect, it } from 'vitest';
import { cluster } from '../testHelpers/letterApprovalHarness';
import { createApp, login } from '../testHelpers/vacancyPitchHarness';

/** B678: сверка резюме hh.ru с вакансией (cluster-99 требует Node.js, TypeScript, Kubernetes, PostgreSQL). */
const RESUMES = '/api/v1/candidate/hh/resumes';
const REVIEW = `${RESUMES}/review?vacancyId=cluster-99`;
const ORIGIN = 'http://localhost:3000';

const SNAPSHOT = {
  resumes: [
    { id: 'lead', title: 'Руководитель разработки' },
    { id: 'node', title: 'Node.js-разработчик' },
  ],
  selected: { id: 'node', title: 'Node.js-разработчик', text: 'Node.js, TypeScript, PostgreSQL.' },
  contents: [{ id: 'lead', title: 'Руководитель разработки', text: 'Node.js, TypeScript, Kubernetes, PostgreSQL.' }],
};

async function harness(cabinetB640: boolean) {
  const { app } = await createApp([cluster], { cabinetB640 });
  const { cookie } = await login(app);
  const call = (method: 'GET' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });
  return { app, call };
}

describe('B678: сверка резюме hh.ru с вакансией', () => {
  it('у каждого прочитанного резюме — подходит или чего не хватает, и какое рекомендуем', async () => {
    const { call } = await harness(true);
    expect((await call('PUT', RESUMES, SNAPSHOT)).statusCode).toBe(200);

    const response = await call('GET', REVIEW);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      vacancyId: 'cluster-99',
      recommendedId: 'lead',
      resumes: [
        { resumeId: 'lead', status: 'fits', missing: [] },
        { resumeId: 'node', status: 'gaps', missing: ['Kubernetes'] },
      ],
    });
  });

  it('прочитанное содержимое должно принадлежать резюме из списка', async () => {
    const { call } = await harness(true);
    const stray = { ...SNAPSHOT, contents: [{ id: 'other', title: 'Чужое', text: 'Текст' }] };
    expect((await call('PUT', RESUMES, stray)).statusCode).toBe(400);
  });

  it('резюме ещё не читали или вакансии нет — понятный ответ', async () => {
    const { call } = await harness(true);
    const unread = await call('GET', REVIEW);
    expect(unread.statusCode).toBe(409);
    expect(unread.json().error.code).toBe('hh_resumes_not_read');
    await call('PUT', RESUMES, SNAPSHOT);
    const missing = await call('GET', `${RESUMES}/review?vacancyId=no-such`);
    expect(missing.statusCode).toBe(404);
  });

  it('без флага B640 маршрут отвечает как несуществующий, прежний снимок без contents пишется как раньше', async () => {
    const { call } = await harness(false);
    const response = await call('GET', REVIEW);
    expect(response.statusCode).toBe(404);
    const flagged = await harness(true);
    const { contents: _skip, ...plain } = SNAPSHOT;
    const saved = await flagged.call('PUT', RESUMES, plain);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).not.toHaveProperty('contents');
  });

  it('выбор резюме без contents сохраняет прочитанное раньше; тексты в интерфейс не уходят', async () => {
    const { call } = await harness(true);
    await call('PUT', RESUMES, SNAPSHOT);
    const { contents: _skip, ...choice } = SNAPSHOT;
    const chosen = await call('PUT', RESUMES, { ...choice, selected: { id: 'lead', title: 'Руководитель разработки', text: 'Kubernetes' } });
    expect(chosen.json().data).not.toHaveProperty('contents');
    expect((await call('GET', RESUMES)).json().data).not.toHaveProperty('contents');
    const review = (await call('GET', REVIEW)).json().data;
    // «lead» сверяется по новому выбранному тексту; у «node» текста среди прочитанных нет.
    expect(review.resumes.map((fit: { status: string }) => fit.status)).toEqual(['gaps', 'unread']);
    expect(review.resumes[0].matched).toContain('Kubernetes');
  });

  it('для сверки не больше пяти резюме и текст не длиннее предела', async () => {
    const { call } = await harness(true);
    const many = Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, title: `Резюме ${index}`, text: 'Опыт' }));
    const six = { resumes: many.map(({ id, title }) => ({ id, title })), selected: null, contents: many };
    expect((await call('PUT', RESUMES, six)).statusCode).toBe(400);
    const long = { ...SNAPSHOT, contents: [{ ...SNAPSHOT.contents[0]!, text: 'я'.repeat(8_001) }] };
    expect((await call('PUT', RESUMES, long)).statusCode).toBe(400);
  });
});
