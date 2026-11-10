import { describe, expect, it } from 'vitest';
import type { VacancyCluster } from './domain/unifiedVacancy';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import {
  letterPrompt,
  type CoverLetterWriter,
  type CoverLetterWriteInput,
} from './providers/coverLetterWriter';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

const sampleCluster: VacancyCluster = {
  id: 'cluster-99',
  canonicalTitle: 'IT Лидер кластера / Head of AI Engineering',
  canonicalCompany: 'Сбер',
  canonicalLocation: 'Москва',
  isRemote: false,
  descriptionSummary: 'Руководство AI-инженерией кластера',
  skills: ['Python', 'LLM'],
  primaryUrl: 'https://example.com/vacancies/sber',
  sources: [],
  firstObservedAt: '2026-11-10T00:00:00.000Z',
  lastSeenAt: '2026-11-10T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

describe('B639: работа в компании вакансии или её группе', () => {
  const MASK = 'Corporate University of a Top-Tier Financial Institution';
  const letterInputFor = async (company: string, answer?: string) => {
    const inputs: CoverLetterWriteInput[] = [];
    const writer: CoverLetterWriter = {
      writeCoverLetter: async (input) => {
        inputs.push(input);
        return { body: 'Здравствуйте! Откликаюсь на вакансию.', stage: 'openai:gpt-test' };
      },
    };
    const cluster = { ...sampleCluster, id: 'cluster-sber', canonicalCompany: company };
    const { app, candidates } = await createApp([cluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.addManualExperienceFact(candidateId, 'chrono-cu', `IT Lead, ${MASK}`);
    candidates.addManualExperienceFact(candidateId, 'chrono-rc', 'VP of Technology, Россети Цифра');
    candidates.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        experience: [
          {
            id: 'w1',
            chronologyMemoryId: 'chrono-rc',
            employer: 'Россети Цифра',
            current: false,
            bulletMemoryIds: [],
          },
          {
            id: 'w2',
            chronologyMemoryId: 'chrono-cu',
            employer: MASK,
            current: false,
            bulletMemoryIds: [],
          },
        ],
      },
      [],
    );
    if (answer) candidates.answerEmployerName(candidateId, 'name-cu', MASK, { name: answer });
    // Ответ маршрута здесь не важен: проверяется, что ушло в запрос письма.
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-sber/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });
    expect(inputs.length).toBeGreaterThan(0);
    return inputs[0];
  };

  it('вакансия Сбера и место «Корпоративный университет Сбера»: связь уходит в запрос письма', async () => {
    const input = await letterInputFor('Сбер', 'Корпоративный университет Сбера');
    expect(input?.companyLink).toBe('Корпоративный университет Сбера');
    expect(letterPrompt(input!)).toContain('Кандидат работал в «Корпоративный университет Сбера»');
  });

  it('без ответа о маске и у чужой компании связи нет', async () => {
    expect((await letterInputFor('Сбер'))?.companyLink).toBeUndefined();
    expect(
      (await letterInputFor('CoinsPaid', 'Корпоративный университет Сбера'))?.companyLink,
    ).toBeUndefined();
  });
});
