import { DatabaseSync } from 'node:sqlite';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { CoverLetterWriter } from '../providers/coverLetterWriter';
import { createApp, login } from './vacancyPitchHarness';

/** Стенд одобрения письма с резюме (B601): вакансия, засев резюме и чтение привязки из таблицы. */
export const cluster: VacancyCluster = {
  id: 'cluster-99',
  canonicalTitle: 'Senior Platform Engineer',
  canonicalCompany: 'CloudScale Inc',
  canonicalLocation: 'Remote',
  isRemote: true,
  descriptionSummary: 'Платформа на Node.js и Kubernetes',
  skills: ['Node.js', 'TypeScript', 'Kubernetes', 'PostgreSQL'],
  primaryUrl: 'https://example.com/vacancies/99',
  sources: [],
  firstObservedAt: '2026-09-17T00:00:00.000Z',
  lastSeenAt: '2026-09-17T00:00:00.000Z',
  status: 'active',
  vacanciesCount: 1,
};

export const LETTER = {
  circle: 3,
  language: 'ru',
  tone: 'executive',
  body: 'Добрый день. Готов обсудить платформу. Резюме приложено.',
  usedEvidenceIds: [],
  includedWorkplaceIds: [],
};

export type Candidates = Awaited<ReturnType<typeof createApp>>['candidates'];

/** Место работы попадает в снимок, только когда его подтверждает факт профиля. */
export function seedResume(candidates: Candidates, candidateId: string, title: string): void {
  const memoryId = 'import:test:role-' + title.length;
  candidates.importResumeEvidence(candidateId, {
    sourceLabel: 'synthetic',
    entries: [{ memoryId, domain: 'outcome', statement: title + ', Финтех Лаб, с 2021 года.' }],
  } as never);
  candidates.reviewMemories(candidateId, [memoryId], 'confirm');
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    candidate: { fullName: 'Мила Пример' },
    experience: [{
      id: 'exp-1',
      chronologyMemoryId: memoryId,
      title,
      employer: 'Финтех Лаб',
      startDate: '2021-01',
      current: true,
      bulletMemoryIds: [],
    }],
  };
  candidates.saveResumeDraft(candidateId, draft, []);
}

export interface SetupOptions {
  readonly billingEnforcement?: boolean;
  readonly coverLetterWriter?: CoverLetterWriter;
}

export async function setup(role?: string, options: SetupOptions = {}) {
  const { app, candidates, databasePath } = await createApp([cluster], {
    ...(options.billingEnforcement ? { billingEnforcement: true } : {}),
    ...(options.coverLetterWriter ? { coverLetterWriter: options.coverLetterWriter } : {}),
  });
  const { cookie, candidateId } = await login(app);
  if (role) seedResume(candidates, candidateId, role);
  const approve = (extra: Record<string, unknown> = {}) => app.inject({
    method: 'POST',
    url: '/api/v1/candidate/vacancies/cluster-99/letter-approvals',
    headers: { cookie, origin: 'http://localhost:3000' },
    payload: { ...LETTER, ...extra },
  });
  const prepareResume = () => app.inject({
    method: 'POST',
    url: '/api/v1/candidate/vacancies/cluster-99/letter-resume',
    headers: { cookie, origin: 'http://localhost:3000' },
    payload: {},
  });
  const pitch = () => app.inject({
    method: 'POST',
    url: '/api/v1/candidate/vacancies/cluster-99/pitch',
    headers: { cookie, origin: 'http://localhost:3000' },
    payload: {},
  });
  const resumeDocuments = () =>
    candidates.getSnapshot(candidateId).documents.filter((document) => document.kind === 'resume');
  const versions = () => candidates.listResumeVersions(candidateId, { limit: 50, cursor: null }).items;
  // Привязку читаем прямо из таблицы: у хранилища нет чтения материала заявки.
  const linkedResume = (applicationId: string) => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = database
        .prepare("SELECT document_id FROM application_materials WHERE application_id = ? AND role = 'resume'")
        .get(applicationId) as { document_id: string } | undefined;
      return row?.document_id;
    } finally {
      database.close();
    }
  };
  return { candidates, candidateId, approve, prepareResume, pitch, resumeDocuments, versions, linkedResume };
}

