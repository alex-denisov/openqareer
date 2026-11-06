import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import type { VacancyCluster } from './domain/unifiedVacancy';
import { QueuedCoverLetterWriter, type CoverLetterWriter, type CoverLetterWriteInput } from './providers/coverLetterWriter';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

const sampleCluster: VacancyCluster = {
  id: 'cluster-99',
  canonicalTitle: 'Senior Platform Engineer',
  canonicalCompany: 'CloudScale Inc',
  canonicalLocation: 'Remote',
  isRemote: true,
  descriptionSummary: 'Разработка высоконагруженной платформы на Node.js и Kubernetes',
  skills: ['Node.js', 'TypeScript', 'Kubernetes', 'PostgreSQL'],
  primaryUrl: 'https://example.com/vacancies/99',
  sources: [],
  firstObservedAt: '2026-09-17T00:00:00.000Z',
  lastSeenAt: '2026-09-17T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

describe('POST /pitch: письмо модели (B601)', () => {
  describe('B601: отказ всей цепочки модели', () => {
    const LETTER = 'Письмо модели. Резюме приложено.';
    const refusing = (): CoverLetterWriter => ({
      writeCoverLetter: async () => ({ failure: { stage: 'openrouter:deepseek/deepseek-v4.1-flash', kind: 'timeout' } }),
    });
    const pitch = (app: Awaited<ReturnType<typeof createApp>>['app'], cookie: string, payload: Record<string, unknown> = {}) => app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload,
    });

    it('вся цепочка отказала: понятная ошибка без шаблона и без имён моделей', async () => {
      const { app, cookie } = await appWith(refusing());
      const response = await pitch(app, cookie);
      expect(response.statusCode).toBe(503);
      const { error, data } = response.json();
      expect(data).toBeUndefined();
      expect(error).toMatchObject({ code: 'letter_generation_failed', retryable: true });
      expect(error.message).toBe('Не удалось подготовить письмо. Попробуйте ещё раз.');
      expect(response.body).not.toMatch(/deepseek|glm|gemini|openrouter|vertex|модел/iu);
    });

    it('письмо отклика не сохраняется, когда цепочка отказала', async () => {
      const { app, cookie, candidates, candidateId: ownerId } = await appWith(refusing());
      const save = vi.spyOn(candidates, 'saveDocumentAndLinkApplicationMaterial');
      const application = candidates.createApplication(ownerId, {
        stage: 'saved',
        manualVacancy: { title: sampleCluster.canonicalTitle, company: 'Synthetic', url: 'https://example.com/b601', source: 'remotive' },
      });
      expect((await pitch(app, cookie, { applicationId: application.id })).statusCode).toBe(503);
      expect(save).not.toHaveBeenCalled();
    });

    it('отказала одна модель: кандидат получает письмо следующей, ошибки нет', async () => {
      const second = vi.fn(async () => ({ body: LETTER, stage: 'second' }));
      const writer = new QueuedCoverLetterWriter([refusing(), { writeCoverLetter: second }], [], () => undefined);
      const { app, cookie } = await appWith(writer);
      const response = await pitch(app, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.emailPitch.body).toBe(LETTER);
      expect(response.json().data.bodySource).toBe('model');
    });

    it('повтор запускает всю цепочку заново с первой модели', async () => {
      const first = vi.fn(async () => ({ failure: { stage: 'first', kind: 'timeout' as const } }));
      const last = vi.fn(async () => ({ failure: { stage: 'last', kind: 'timeout' as const } }));
      const writer = new QueuedCoverLetterWriter([{ writeCoverLetter: first }, { writeCoverLetter: last }], [], () => undefined);
      const { app, cookie } = await appWith(writer);
      expect((await pitch(app, cookie)).statusCode).toBe(503);
      expect((await pitch(app, cookie)).statusCode).toBe(503);
      expect(first).toHaveBeenCalledTimes(2);
      expect(last).toHaveBeenCalledTimes(2);
    });

    it('модель выключена: прежний шаблон, ошибки нет', async () => {
      const { app, cookie } = await appWith(undefined);
      const response = await pitch(app, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.bodySource).toBe('template');
      expect(response.json().data.emailPitch.body).not.toBe('');
    });

    it('профиль пуст: это не отказ цепочки, модель не вызвана, ошибки нет', async () => {
      const write = vi.fn(async () => ({ failure: { stage: 'first', kind: 'timeout' as const } }));
      const created = await createApp([sampleCluster], {
        coverLetterWriter: new QueuedCoverLetterWriter([{ writeCoverLetter: write }], [], () => undefined),
      });
      const { cookie } = await login(created.app);
      const response = await pitch(created.app, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.bodySource).toBe('template');
      expect(write).not.toHaveBeenCalled();
    });

    async function appWith(writer: CoverLetterWriter | undefined) {
      const created = await createApp([sampleCluster], writer ? { coverLetterWriter: writer } : {});
      const { cookie, candidateId } = await login(created.app);
      created.candidates.importResumeEvidence(candidateId, {
        sourceLabel: 'test-import',
        entries: [{ memoryId: 'mem-chain', domain: 'outcome', statement: 'Вырастил выручку до 2 млрд рублей' }],
      } as never);
      created.candidates.reviewMemories(candidateId, ['mem-chain'], 'confirm');
      return { ...created, cookie, candidateId };
    }
  });

  it('B601: род определяется по имени из профиля, неоднозначное имя рода не даёт', async () => {
    const inputs: CoverLetterWriteInput[] = [];
    const writer: CoverLetterWriter = {
      writeCoverLetter: async (input) => {
        inputs.push(input);
        return { body: 'Письмо. Резюме приложено.', stage: 'openai:gpt-test' };
      },
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie } = await login(app);
    const request = () => app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });
    const withName = (fullName: string) => vi.spyOn(candidates, 'getSnapshot').mockImplementation(
      () => ({ resume: { draft: { ...EMPTY_RESUME_DRAFT, candidate: { fullName, headline: 'CTO' } } } }) as never,
    );
    withName('Мария Иванова');
    await request();
    expect(inputs.at(-1)?.gender).toBe('female');
    withName('Alexey Denisov');
    await request();
    expect(inputs.at(-1)?.gender).toBe('male');
    withName('Chris Taylor');
    await request();
    expect(inputs.at(-1)?.gender).toBeUndefined();
  });
});
