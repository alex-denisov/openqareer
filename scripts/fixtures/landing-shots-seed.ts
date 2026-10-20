import type { CandidateStore } from '../../server/data/candidateStore';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';

/**
 * Extra synthetic data for landing screenshots (B535): every sent application has a collected
 * cover letter and the funnel shows neighbouring engineering-leadership roles of one candidate. Loopback demo only; the
 * companies are invented and nothing is sent anywhere. Enabled with LANDING_SHOTS=1.
 */
type LandingSeedStore = Pick<
  CandidateStore,
  | 'createApplication'
  | 'patchApplication'
  | 'createApplicationInterview'
  | 'listApplications'
  | 'saveDocumentAndLinkApplicationMaterial'
>;

const EXTRA = [
  { title: 'Engineering Manager', company: 'Северный Ритейл', stage: 'responded' },
  { title: 'Head of Platform', company: 'Стройинвест Диджитал', stage: 'responded' },
  { title: 'VP Engineering', company: 'Облако Плюс', stage: 'interview' },
  { title: 'Director of Engineering', company: 'Дистрибуция Плюс', stage: 'interview' },
] as const;

const SENT_STAGES = new Set(['applied', 'responded', 'interview', 'offer']);

function vacancy(title: string, company: string): VacancyApplicationSnapshot {
  const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/gu, '-'));
  return { title, company, source: 'other', url: `https://example.test/jobs/${slug}` };
}

function daysAgo(now: Date, days: number, hourUtc = 9): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

function seedExtraApplications(store: LandingSeedStore, candidateId: string, now: Date): void {
  EXTRA.forEach((item, index) => {
    const created = store.createApplication(candidateId, {
      clusterId: `landing-extra-${index}`,
      manualVacancy: vacancy(item.title, item.company),
      stage: 'saved',
      occurredAt: daysAgo(now, 9 - index),
    });
    const applied = store.patchApplication(candidateId, created.id, {
      expectedVersion: created.version,
      stage: 'applied',
      occurredAt: daysAgo(now, 8 - index),
      deliveryReceipt: { kind: 'confirmation_url', value: `https://example.test/landing/${index}` },
    });
    const moved = store.patchApplication(candidateId, applied.id, {
      expectedVersion: applied.version,
      stage: item.stage,
      occurredAt: daysAgo(now, 3 - (index % 2)),
    });
    store.patchApplication(candidateId, moved.id, {
      expectedVersion: moved.version,
      followUpDueAt: daysAgo(now, -4 - index),
    });
    if (item.stage === 'interview') {
      store.createApplicationInterview(candidateId, moved.id, {
        round: 1,
        scheduledAt: daysAgo(now, -2 - index, 10),
        format: 'video',
      });
    }
  });
}

function linkCoverLetters(store: LandingSeedStore, candidateId: string): void {
  for (const application of store.listApplications(candidateId)) {
    if (!SENT_STAGES.has(application.stage)) continue;
    const company = application.vacancy?.company ?? 'компанию';
    const text = `Сопроводительное письмо в «${company}», собрано из подтверждённых фактов профиля.`;
    store.saveDocumentAndLinkApplicationMaterial(candidateId, application.id, 'cover_letter', {
      kind: 'cover_letter',
      source: 'generated',
      fileName: `letter-${application.id}.txt`,
      mimeType: 'text/plain',
      contentBase64: Buffer.from(text, 'utf8').toString('base64'),
      extractedText: text,
      parseStatus: 'not_applicable',
    });
  }
}

export function seedLandingShots(
  store: LandingSeedStore,
  candidateId: string,
  now = new Date(),
): void {
  seedExtraApplications(store, candidateId, now);
  linkCoverLetters(store, candidateId);
}
