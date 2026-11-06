import { describe, expect, it } from 'vitest';
import type { VacancyCluster } from './domain/unifiedVacancy';
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

describe('B528 generated text fact gate', () => {
  it('asks for confirmation of imported template claims even without a model writer', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'imp0123456789-template', domain: 'outcome', statement: 'Я увеличил выручку на 25%.' }],
    });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'ru' },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe('template');
    expect(data.atsCoverLetter).toContain('25%');
    expect(data.outputFactChecks.atsCoverLetter.status).toBe('needs_confirmation');
    expect(data.notices).toEqual(expect.arrayContaining([
      expect.stringMatching(/Перед отправкой сверьте с профилем.*25%/u),
    ]));
    expect(candidates.getSnapshot(candidateId).memory.find((fact) => fact.id === 'imp0123456789-template')?.status).toBe('proposed');
  });

  it('B528 rejects invented metrics before returning or saving a model letter', async () => {
    const { app, candidates } = await createApp([sampleCluster], {
      coverLetterWriter: { writeCoverLetter: async () => ({
        body: 'Я увеличил выручку на 90%.', stage: 'test:model',
      }) },
    });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'b528-real', domain: 'outcome', statement: 'Я увеличил выручку на 20%.' }],
    });
    candidates.reviewMemories(candidateId, ['b528-real'], 'confirm');
    const application = candidates.createApplication(candidateId, {
      stage: 'saved', manualVacancy: {
        title: sampleCluster.canonicalTitle, company: 'Synthetic company',
        url: 'https://example.com/b528', source: 'remotive',
      },
    });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId: application.id },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('90%');
    expect(candidates.getSnapshot(candidateId).documents.find((doc) => doc.kind === 'cover_letter')).toBeUndefined();
  });

  it('04.11: a paraphrase of imported facts reaches the letter screen under the note that a model wrote it', async () => {
    const body = 'Здравствуйте! Занимался логистикой для сети магазинов, команда выросла с 8 до 35 человек. Резюме приложено. Буду рад обсудить задачи роли.';
    const { app, candidates } = await createApp([sampleCluster], {
      coverLetterWriter: { writeCoverLetter: async () => ({ body, stage: 'test:model' }) },
    });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'imp0123456789-ach', domain: 'outcome', statement: 'Склад и логистика для сети магазинов, команда выросла с 8 до 35 человек.' }],
    });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'ru' },
    });
    const data = response.json().data;
    expect(data.bodySource).toBe('model');
    // The letter screen shows emailPitch.body: a letter only in atsCoverLetter is never seen.
    expect(data.emailPitch.body).toBe(body);
    expect(data.atsCoverLetter).toBe(body);
    expect(data.factCheck.status).toBe('checked');
    expect(data.outputFactChecks.emailBody.status).toBe('checked');
    // The gate does not check what a paraphrase means, so the screen promises no checking.
    expect(data.notices).toEqual(['Черновик написала модель. Прочитайте его перед отправкой.']);
  });

  it('04.11: a stage whose letter fails the gate gives way, a transliterated employer never shows', async () => {
    const seen: string[] = [];
    const { app, candidates } = await createApp([sampleCluster], {
      coverLetterWriter: {
        writeCoverLetter: async (input) => {
          const body = 'Worked at Fintech Lab as Head of Engineering.';
          seen.push(...(input.review?.(body) ?? []));
          return { body, stage: 'test:model' };
        },
      },
    });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'synthetic',
      entries: [{ memoryId: 'imp0123456789-ach', domain: 'outcome', statement: 'Built logistics for a retail chain.' }],
    });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' }, payload: { language: 'en' },
    });
    expect(seen).toContain('name');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('Fintech Lab');
  });

  // B601: the gate stops wrong numbers and foreign companies only; role and wording are the reader's call,
  // so a letter that overstates a role reaches the candidate with its claims listed as unconfirmed.
  it.each([
    {
      name: 'confirmed metric with its context',
      facts: ['Я увеличил выручку на 20%.'],
      text: 'Я увеличил выручку на 20%.', expected: 'confirmed', source: 'model',
    },
    {
      name: 'same number with a different unit',
      facts: ['Я управлял бюджетом 40 млн рублей.'],
      text: 'Я увеличил выручку на 40%.', expected: 'not_in_profile', source: 'refused',
    },
    {
      name: 'currency symbols must not be interchangeable',
      facts: ['Я управлял бюджетом 40$.'],
      text: 'Я управлял бюджетом 40€.', expected: 'not_in_profile', source: 'refused',
    },
    {
      name: 'a negative number cannot confirm a positive one',
      facts: ['Я увеличил выручку на -20%.'],
      text: 'Я увеличил выручку на 20%.', expected: 'partially_confirmed', source: 'refused',
    },
    {
      name: 'dropping a pound unit cannot be confirmed',
      facts: ['I managed £40.'],
      text: 'I managed 40.', expected: 'partially_confirmed', source: 'model',
    },
    {
      name: 'unlisted project verbs still require evidence',
      facts: ['Участвовал в проекте Atlas.'],
      text: 'Координировал проект Atlas.', expected: 'not_in_profile', source: 'model',
    },
    {
      name: 'same number with an unrelated achievement',
      facts: ['Я снизил расходы на 20%.'],
      text: 'Я увеличил выручку на 20%.', expected: 'partially_confirmed', source: 'model',
    },
    {
      name: 'before and after from separate facts',
      facts: ['Время обработки составляло 30 минут.', 'Время ответа составляло 10 минут.'],
      text: 'Я снизил время обработки с 30 до 10 минут.', expected: 'partially_confirmed', source: 'model',
    },
    {
      name: 'before and after in one confirmed fact',
      facts: ['Я снизил время обработки с 30 до 10 минут.'],
      text: 'Я снизил время обработки с 30 до 10 минут.', expected: 'confirmed', source: 'model',
    },
    {
      name: 'reversed direction is not confirmed',
      facts: ['Я снизил время обработки с 30 до 10 минут.'],
      text: 'Я снизил время обработки с 10 до 30 минут.', expected: 'partially_confirmed', source: 'refused',
    },
    {
      // 04.11: imported facts are the candidate's own data, the template quotes them too; with the
      // old rule no candidate with an imported profile could ever get a model letter.
      name: 'imported proposed evidence supports the letter and stays partial',
      facts: ['Я увеличил выручку на 25%.'], proposed: true,
      text: 'Я увеличил выручку на 25%.', expected: 'partially_confirmed', source: 'model',
    },
    {
      name: 'candidate explicitly cannot confirm a metric',
      facts: ['Не могу подтвердить: я увеличил выручку на 20%.'],
      text: 'Я увеличил выручку на 20%.', expected: 'cannot_confirm', source: 'refused',
    },
    {
      name: 'project participation does not prove authorship',
      facts: ['Я участвовал в проекте Atlas.'],
      text: 'Я создал проект Atlas.', expected: 'not_in_profile', source: 'model',
    },
    {
      name: 'third party ownership is not personal ownership',
      facts: ['Заказчик создал проект Atlas.'],
      text: 'Я создал проект Atlas.', expected: 'not_in_profile', source: 'model',
    },
    {
      name: 'English negation cannot prove ownership',
      facts: ['I have not created project Atlas.'],
      text: 'I created project Atlas.', expected: 'not_in_profile', source: 'model',
    },
    {
      name: 'first person achievements require evidence',
      facts: ['Я участвовал в проекте Atlas.'],
      text: 'Я организовал проект Atlas.', expected: 'not_in_profile', source: 'model',
    },
    {
      name: 'explicit project ownership',
      facts: ['Я создал проект Atlas.'],
      text: 'Я создал проект Atlas.', expected: 'confirmed', source: 'model',
    },
    {
      name: 'excluded evidence cannot support generation',
      facts: ['Я увеличил выручку на 20%.'], excluded: true, emptyProfile: true,
      text: 'Я увеличил выручку на 20%.', expected: 'not_in_profile', source: 'refused',
    },
    {
      name: 'another candidate cannot support generation',
      facts: ['Я увеличил выручку на 20%.'], foreign: true, emptyProfile: true,
      text: 'Я увеличил выручку на 20%.', expected: 'not_in_profile', source: 'refused',
    },
    {
      name: 'negated fact cannot confirm achievement',
      facts: ['Я не увеличил выручку на 20%.'],
      text: 'Я увеличил выручку на 20%.', expected: 'not_in_profile', source: 'refused',
    },
  ])('B528 $name', async ({ facts, text, expected, source, ...options }) => {
    const { app, candidates } = await createApp([sampleCluster], {
      coverLetterWriter: { writeCoverLetter: async () => ({ body: `${text}\n\nCV attached.`, stage: 'test:model' }) },
    });
    const { cookie, candidateId } = await login(app);
    const owner = options.foreign
      ? candidates.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }).id : candidateId;
    const ids = facts.map((_, index) => (options.proposed ? `imp0123456789-b528-${index}` : `import:test:b528-${index}`));
    candidates.importResumeEvidence(owner, {
      sourceLabel: 'synthetic',
      entries: facts.map((statement, index) => ({ memoryId: ids[index], domain: 'outcome', statement })),
    });
    if (!options.proposed) candidates.reviewMemories(owner, ids, 'confirm');
    const response = await app.inject({
      method: 'POST', url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { language: 'en', ...(options.excluded ? { excludedEvidenceIds: ids } : {}) },
    });
    if (source === 'refused') {
      // Профиль пуст: модель не спрашивали, это не отказ цепочки. Текст модели не показан в обоих случаях.
      expect(response.statusCode).toBe(options.emptyProfile ? 200 : 503);
      expect(response.body).not.toContain(text);
      return;
    }
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe(source);
    expect(data.factCheck.claims).toEqual([expect.objectContaining({
      text, status: expected, action: expected === 'confirmed' ? 'none' : 'ask_candidate',
    })]);
    expect(data.atsCoverLetter).toBe(`${text}\n\nCV attached.`);
    if (expected === 'confirmed') expect(data.factCheck.claims[0].evidenceIds).toEqual([ids[0]]);
  });

});
