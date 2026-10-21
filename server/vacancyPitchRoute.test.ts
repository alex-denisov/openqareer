import { describe, expect, it, vi } from 'vitest';
import type { VacancyCluster } from './domain/unifiedVacancy';
import type { CoverLetterWriter, CoverLetterWriteInput } from './providers/coverLetterWriter';
import { normalizeJsonSource } from './vacancies/jsonSourceAdapters';
import { createApp, login } from './testHelpers/vacancyPitchHarness';
import type { VacancyDescriptionLoader } from './vacancies/multiSourceVacancyEngine';

describe('POST /api/v1/candidate/vacancies/:id/letter-approvals (B449)', () => {
  it('stores a candidate-approved letter snapshot on a saved application without sending it', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);
    const body = {
      circle: 1,
      language: 'ru',
      tone: 'executive',
      recipient: { id: 'recruiter-1', name: 'Мария Орлова', role: 'Рекрутер' },
      subject: 'Head of Platform',
      body: 'Мария, добрый день. Подтверждённый факт о платформе.',
      usedEvidenceIds: [],
      includedWorkplaceIds: ['experience-1'],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/letter-approvals',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: 'approved', sent: false });
    const applicationId = response.json().data.applicationId as string;
    const application = candidates.getApplication(candidateId, applicationId);
    expect(application).toMatchObject({ clusterId: 'cluster-99', stage: 'saved' });
    expect(application?.materials.coverLetter).toBe(true);
    const documentId = response.json().data.documentId as string;
    const document = candidates.getDocument(candidateId, documentId);
    expect(document?.extractedText).toContain(body.body);
    expect(
      JSON.parse(Buffer.from(document!.contentBase64, 'base64').toString('utf8')),
    ).toMatchObject({
      version: 1,
      circle: 1,
      recipient: body.recipient,
      body: body.body,
    });
  });
});

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

describe('POST /api/v1/candidate/vacancies/:id/pitch', () => {
  it('rejects unauthenticated requests with 401 or redirection', async () => {
    const { app } = await createApp([sampleCluster]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects unsafe origin with 403', async () => {
    const { app } = await createApp([sampleCluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://malicious.site' },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('does not save a generated document for another candidate application', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);
    const otherCandidate = candidates.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const foreignApplication = candidates.createApplication(otherCandidate.id, {
      stage: 'applied',
      manualVacancy: {
        title: 'Senior Platform Engineer',
        company: 'CloudScale Inc',
        url: 'https://example.com/vacancies/99',
        source: 'remotive',
      },
    });
    const documentsBefore = candidates.getSnapshot(candidateId).documents.length;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId: foreignApplication.id },
    });

    expect(response.statusCode).toBe(404);
    expect(candidates.getSnapshot(candidateId).documents).toHaveLength(documentsBefore);
  });

  it('returns 404 when vacancy is not found and no override provided', async () => {
    const { app } = await createApp([]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/non-existent/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  // Владелец 2026-09-20: «Подготовить отклик» в .app — ошибка, а прод после
  // нажатия перестаёт отвечать. Маршрут искал кластер через
  // `getActiveClusters().find(...)`, то есть поднимал все 120K кластеров.
  it('reads one persisted cluster instead of hydrating the whole pool (PRB-041)', async () => {
    const { app } = await createApp([sampleCluster], { persisted: true });
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.emailPitch.subject).toContain('Senior Platform Engineer');
  });

  // Прод 2026-09-21: id кластера — это ключ источника с полным адресом
  // (`cluster-src-himalayas-api:https://himalayas.app/companies/…/jobs/…`),
  // 130+ символов; Fastify по умолчанию режет параметр на 100 и отвечает 414
  // без текста сервера — кандидат видел «Сервис не завершил действие».
  it('accepts a long source-keyed cluster id in the path (PRB-041)', async () => {
    const longId =
      'cluster-src-himalayas-api:https://himalayas.app/companies/bright-vision-technologies/jobs/solutions-architect-and-platform-lead';
    const { app } = await createApp([{ ...sampleCluster, id: longId }], { persisted: true });
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancies/${encodeURIComponent(longId)}/pitch`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.vacancyId).toBe(longId);
  });

  it('generates pitch with 3 formats using confirmed candidate facts', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);

    // Add confirmed facts to candidate
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        {
          memoryId: 'mem-101',
          domain: 'outcome',
          statement: 'Увеличил пропускную способность API в 4 раза, снизил p99 latency до 45мс',
        },
        {
          memoryId: 'mem-102',
          domain: 'skill',
          statement: 'Владею TypeScript, Node.js, PostgreSQL, Redis',
        },
      ],
    });
    candidates.reviewMemories(candidateId, ['mem-101', 'mem-102'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { tone: 'technical', excludedEvidenceIds: ['mem-102'] },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data).toMatchObject({
      vacancyId: 'cluster-99',
      emailPitch: {
        subject: expect.stringContaining('Senior Platform Engineer'),
        body: expect.stringContaining('CloudScale Inc'),
      },
      linkedInNote: expect.any(String),
      atsCoverLetter: expect.stringContaining('Senior Platform Engineer'),
      usedEvidenceIds: expect.arrayContaining(['mem-101']),
    });

    expect(json.data.usedEvidenceIds).not.toContain('mem-102');
    expect(json.data.linkedInNote.length).toBeLessThanOrEqual(300);
  });

  it('uses the stored model parse and ontology campaign role to put its evidence first (B267 S6)', async () => {
    const opaqueTitle = 'Principal Systems Steward';
    const { app, candidates } = await createApp(
      [{ ...sampleCluster, canonicalTitle: opaqueTitle }],
      {
        titleParse: {
          titleKey: 'principal systems steward',
          sampleTitle: opaqueTitle,
          functions: ['eng-mgmt'],
          levelRank: 4,
          roleLabel: 'Chief Technology Officer',
          parsedBy: 'model',
          model: 'test-title-model',
          taxonomyVersion: 1,
          priority: 0,
        },
      },
    );
    const { cookie, candidateId } = await login(app);
    candidates.saveCandidateWorkspace(candidateId, {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: '',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'exploring',
      campaign: {
        roles: [],
        regions: [],
        revision: 1,
        updatedAt: '2026-09-26T00:00:00.000Z',
        auto: {
          roles: [
            {
              id: 'eng-mgmt.cto',
              title: 'Chief Technology Officer',
              titleRu: 'Технический директор',
              functions: ['other'],
              level: 'c-level',
              kind: 'primary',
              synonyms: [],
              evidenceRefs: ['memory:role-evidence'],
              reason: 'Подтверждённый опыт технического руководства.',
            },
          ],
          factsDigest: 'test-digest',
          generatedAt: '2026-09-26T00:00:00.000Z',
          model: 'test',
        },
      },
    });
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        {
          memoryId: 'memory:other',
          domain: 'outcome',
          statement: 'Improved a delivery process.',
        },
        {
          memoryId: 'memory:role-evidence',
          domain: 'role-evidence',
          statement: 'Chief Technology Officer leading an engineering organisation.',
        },
      ],
    });
    candidates.reviewMemories(candidateId, ['memory:other', 'memory:role-evidence'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.usedEvidenceIds[0]).toBe('memory:role-evidence');
  });

  it('keeps the rules parser path when no stored title parse exists (B267 S6)', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);
    candidates.saveCandidateWorkspace(candidateId, {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: '',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'exploring',
      campaign: {
        roles: [],
        regions: [],
        revision: 1,
        updatedAt: '2026-09-26T00:00:00.000Z',
        auto: {
          roles: [
            {
              id: 'removed.role',
              title: 'Senior Platform Engineer',
              titleRu: 'Старший платформенный инженер',
              functions: ['other'],
              level: 'ic',
              kind: 'primary',
              synonyms: [],
              evidenceRefs: ['memory:rules-evidence'],
              reason: 'Подтверждённый инженерный опыт.',
            },
          ],
          factsDigest: 'test-digest',
          generatedAt: '2026-09-26T00:00:00.000Z',
          model: 'test',
        },
      },
    });
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        { memoryId: 'memory:other', domain: 'outcome', statement: 'Improved a delivery process.' },
        {
          memoryId: 'memory:rules-evidence',
          domain: 'role-evidence',
          statement: 'Senior Platform Engineer building distributed systems.',
        },
      ],
    });
    candidates.reviewMemories(candidateId, ['memory:other', 'memory:rules-evidence'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.usedEvidenceIds[0]).toBe('memory:rules-evidence');
  });

  // B266, пункт 7: письмо пишет модель, шаблон — запас.
  it('uses the model letter and reports its stage when the writer succeeds', async () => {
    const writer: CoverLetterWriter = {
      writeCoverLetter: async () => ({
        body: 'Здравствуйте! Пишу по вакансии от модели.',
        stage: 'openai:gpt-test',
      }),
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [{ memoryId: 'mem-201', domain: 'skill', statement: 'Владею TypeScript, Node.js' }],
    });
    candidates.reviewMemories(candidateId, ['mem-201'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe('model');
    expect(data.stage).toBe('openai:gpt-test');
    expect(data.atsCoverLetter).toBe('Здравствуйте! Пишу по вакансии от модели.');
  });

  it('falls back to the template letter when the writer fails', async () => {
    const writer: CoverLetterWriter = {
      writeCoverLetter: async () => ({ failure: { stage: 'openai:gpt-test', kind: 'timeout' } }),
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [{ memoryId: 'mem-202', domain: 'skill', statement: 'Владею TypeScript, Node.js' }],
    });
    candidates.reviewMemories(candidateId, ['mem-202'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe('template');
    expect(data.stage).toBeUndefined();
    expect(data.atsCoverLetter).toContain('Senior Platform Engineer');
  });

  // B251, S2, architecture.md §4: an optional `applicationId` saves the
  // letter to `candidate_documents` and links it to the card in one call.
  it('saves and links the letter when applicationId is provided', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/applications',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { clusterId: 'cluster-99', stage: 'saved' },
    });
    const applicationId = created.json().data.id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId },
    });
    expect(response.statusCode).toBe(200);

    const documents = candidates.getSnapshot(candidateId)?.documents ?? [];
    const letter = documents.find(
      (doc) => doc.kind === 'cover_letter' && doc.source === 'generated',
    );
    expect(letter).toBeDefined();

    const application = candidates
      .listApplications(candidateId)
      .find((a) => a.id === applicationId);
    expect(application?.materials).toMatchObject({ coverLetter: true });
  });

  // C46 (B251/B267 S6): раскладка 25 с на составляющие — структурная запись,
  // только числа и имя провайдера, без текста письма и фактов.
  it('logs structured vacancy-pitch-timing with numbers and provider name only', async () => {
    const writer: CoverLetterWriter = {
      writeCoverLetter: async () => ({ body: 'Письмо.', stage: 'openai:gpt-test' }),
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [{ memoryId: 'mem-301', domain: 'skill', statement: 'Владею TypeScript, Node.js' }],
    });
    candidates.reviewMemories(candidateId, ['mem-301'], 'confirm');

    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });
    const calls = [...spy.mock.calls];
    spy.mockRestore();

    expect(response.statusCode).toBe(200);
    const entry = calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((parsed) => parsed?.event === 'vacancy-pitch-timing');
    expect(entry).toMatchObject({
      stage: 'openai:gpt-test',
      contextMs: expect.any(Number),
      providerMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(JSON.stringify(entry)).not.toMatch(/TypeScript|Node\.js|mem-301/u);
  });

  it('returns 404 when applicationId belongs to a different candidate', async () => {
    const { app } = await createApp([sampleCluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId: 'not-a-real-application' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('passes recipient to writer prompt and generates contactMessage with profile facts (C72)', async () => {
    let capturedInput: CoverLetterWriteInput | undefined;
    const writer: CoverLetterWriter = {
      writeCoverLetter: async (input) => {
        capturedInput = input;
        return { body: 'Письмо нанимающему.', stage: 'openai:gpt-test' };
      },
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        {
          memoryId: 'mem-401',
          domain: 'outcome',
          statement: 'Увеличил пропускную способность API на 50%',
        },
      ],
    });
    candidates.reviewMemories(candidateId, ['mem-401'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {
        recipient: {
          name: 'Елена Смирнова',
          role: 'Technical Recruiter',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.contactMessage).toBeDefined();
    expect(json.data.contactMessage.length).toBeLessThanOrEqual(600);
    expect(json.data.contactMessage).toContain('Елена Смирнова');
    expect(json.data.contactMessage).toContain('Увеличил пропускную способность API на 50%');
    expect(json.data.usedEvidenceIds).toContain('mem-401');

    expect(capturedInput?.vacancy?.recipient).toEqual({
      name: 'Елена Смирнова',
      role: 'Technical Recruiter',
    });
  });
});

describe('POST /api/v1/vacancies/:id/enrich-contacts', () => {
  const cluster: VacancyCluster = {
    id: 'cluster-77',
    canonicalTitle: 'Product Manager',
    canonicalCompany: 'Acme',
    canonicalLocation: 'Berlin',
    isRemote: false,
    descriptionSummary: 'Контакты: рекрутер Анна Семенова, a.semenova@acme-corp.com',
    skills: [],
    primaryUrl: 'https://careers.acme-corp.com/jobs/77',
    sources: [],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  };

  // Та же причина, что у отклика: «Найти прямые контакты» поднимало весь пул
  // кластеров ради одной записи (владелец 2026-09-20, PRB-041).
  it('reads one persisted cluster instead of hydrating the whole pool (PRB-041)', async () => {
    const { app } = await createApp([cluster], { persisted: true });
    const { cookie } = await login(app);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/search-consent',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { granted: true },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/cluster-77/enrich-contacts',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().data.job).toMatchObject({
      candidateId: expect.any(String),
      vacancyId: 'cluster-77',
      status: 'queued',
    });
  });
});

describe('GET /api/v1/candidate/vacancies/:id/detail (B266)', () => {
  const cluster: VacancyCluster = {
    id: 'cluster-77',
    canonicalTitle: 'VP of Technology',
    canonicalCompany: 'Arctic Wolf',
    canonicalLocation: 'United States',
    isRemote: true,
    descriptionSummary: 'Short summary only',
    skills: ['Cloud', 'P&L'],
    primaryUrl: 'https://example.com/vacancies/77',
    sources: [],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  };

  it('requires a signed-in candidate', async () => {
    const { app } = await createApp([cluster]);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-77/detail',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns the full pooled Jobicy description, not its excerpt or the cluster summary', async () => {
    const jobicyCluster = { ...cluster, id: 'cluster-src-jobicy:151630' };
    const { app, poolStore } = await createApp([jobicyCluster]);
    const excerpt = 'Short source excerpt ending early…';
    const fullText = 'Full posting: lead 250 engineers across three regions. '.repeat(20);
    const vacancies = normalizeJsonSource(
      'src-jobicy',
      {
        jobs: [
          {
            id: 151630,
            url: 'https://jobicy.com/jobs/151630-vp-technology',
            jobTitle: 'VP of Technology',
            companyName: 'Arctic Wolf',
            jobExcerpt: excerpt,
            jobDescription: fullText,
            pubDate: '2026-09-17 00:00:00',
          },
        ],
      },
      { observedAt: '2026-09-17T00:00:00.000Z' },
    );
    poolStore.replaceSourceSlice('src-jobicy', vacancies);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-src-jobicy%3A151630/detail',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: 'cluster-src-jobicy:151630',
      skills: ['Cloud', 'P&L'],
      truncated: false,
    });
    expect(response.json().data.description).toBe(fullText.trim());
  });

  it('marks an old Jobicy record whose full text is only the excerpt as truncated (B266)', async () => {
    const jobicyCluster = { ...cluster, id: 'cluster-src-jobicy:151631' };
    const { app, poolStore } = await createApp([jobicyCluster]);
    const excerpt = 'We are hiring a VP of Technology to lead platform, delivery and…';
    const vacancies = normalizeJsonSource(
      'src-jobicy',
      {
        jobs: [
          {
            id: 151631,
            url: 'https://jobicy.com/jobs/151631-vp-technology',
            jobTitle: 'VP of Technology',
            companyName: 'Arctic Wolf',
            jobExcerpt: excerpt,
            jobDescription: excerpt,
            pubDate: '2026-09-17 00:00:00',
          },
        ],
      },
      { observedAt: '2026-09-17T00:00:00.000Z' },
    );
    poolStore.replaceSourceSlice('src-jobicy', vacancies);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-src-jobicy%3A151631/detail',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ description: excerpt, truncated: true });
  });

  it('marks the cluster summary as truncated when the source record is unavailable', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-77/detail',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      description: 'Short summary only',
      truncated: true,
    });
  });

  it('returns the cluster summary the matched page trims, for the expanded card (B446-g4)', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-77/detail',
      headers: { cookie },
    });

    expect(response.json().data.summary).toBe('Short summary only');
  });

  it('дочитывает полное описание hh только по запросу «Подробнее» и сохраняет его', async () => {
    const hhCluster = { ...cluster, id: 'cluster-src-hh-search:9001' };
    const loader: VacancyDescriptionLoader = {
      load: vi.fn().mockResolvedValue('Полный текст hh-вакансии'),
    };
    const { app, poolStore } = await createApp([hhCluster], { descriptionLoader: loader });
    poolStore.mergeSourceSlice('src-hh-search', [
      {
        id: 'src-hh-search:9001',
        fingerprint: 'src-hh-search:9001',
        title: 'VP of Technology',
        company: 'Arctic Wolf',
        description: 'Короткий сниппет',
        requiredSkills: [],
        isRemote: true,
        url: 'https://hh.ru/vacancy/9001',
        publishedAt: '2026-09-17T00:00:00.000Z',
        status: 'active',
        provenance: {
          sourceType: 'json_api',
          sourceId: 'src-hh-search',
          sourceUrl: 'https://hh.ru/vacancy/9001',
          observedAt: '2026-09-17T00:00:00.000Z',
        },
      },
    ]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-src-hh-search%3A9001/detail',
      headers: { cookie },
    });

    expect(response.json().data).toMatchObject({
      description: 'Полный текст hh-вакансии',
      truncated: false,
    });
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(poolStore.getVacancy('src-hh-search:9001')?.fullDescription).toBe(
      'Полный текст hh-вакансии',
    );
  });

  it('answers 404 for an unknown vacancy', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-nope/detail',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
