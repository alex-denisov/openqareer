import type { CandidateStore } from '../../server/data/candidateStore';
import type { ApplicationStage } from '../../shared/applicationStage';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';

type TodaySeedStore = Pick<
  CandidateStore,
  | 'applicationFunnel'
  | 'createApplication'
  | 'createApplicationInterview'
  | 'listApplications'
  | 'patchApplication'
>;

interface ApplicationSeed {
  readonly key: 'followUp' | 'interview' | 'savedForMaterials' | 'savedForReview';
  readonly clusterId: string;
  readonly vacancy: VacancyApplicationSnapshot;
  readonly stage: ApplicationStage;
  readonly createdAt: string;
  readonly nextStage?: ApplicationStage;
  readonly stageChangedAt?: string;
  readonly followUpDueAt?: string;
  readonly interviewAt?: string;
}

function relativeDate(now: Date, daysFromNow: number, hourUtc: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

function applicationSeeds(now: Date): readonly ApplicationSeed[] {
  return [
    followUpSeed(now),
    interviewSeed(now),
    savedApplicationSeed(
      'savedForMaterials',
      'block-a-today-greencode-saved',
      'Backend Engineer',
      'Гринкод',
      'greencode-backend',
      now,
      1,
    ),
    savedApplicationSeed(
      'savedForReview',
      'block-a-today-kaskad-saved',
      'Platform Engineer',
      'Каскад',
      'kaskad-platform',
      now,
      2,
    ),
  ];
}

/**
 * Populate the disposable local Block A candidate with real application-store
 * records. All entries are synthetic and use example.test URLs. This does not
 * create provider receipts, send messages, or claim external activity.
 */
type SeededApplication = ReturnType<TodaySeedStore['createApplication']>;

function syntheticVacancy(
  title: string,
  company: string,
  slug: string,
): VacancyApplicationSnapshot {
  return {
    title,
    company,
    source: 'other',
    url: `https://example.test/jobs/${slug}`,
  };
}

function followUpSeed(now: Date): ApplicationSeed {
  return {
    key: 'followUp',
    clusterId: 'block-a-today-vector-follow-up',
    vacancy: syntheticVacancy('Head of Engineering', 'Вектор Банк', 'vector-bank-engineering'),
    stage: 'applied',
    createdAt: relativeDate(now, -6, 12),
    followUpDueAt: relativeDate(now, -4, 12),
  };
}

function interviewSeed(now: Date): ApplicationSeed {
  return {
    key: 'interview',
    clusterId: 'block-a-today-arka-interview',
    vacancy: syntheticVacancy('Head of Engineering', 'Арка Холдинг', 'arka-engineering'),
    stage: 'applied',
    createdAt: relativeDate(now, -4, 12),
    nextStage: 'interview',
    stageChangedAt: relativeDate(now, -3, 12),
    interviewAt: relativeDate(now, 2, 10),
  };
}

function savedApplicationSeed(
  key: 'savedForMaterials' | 'savedForReview',
  clusterId: string,
  title: string,
  company: string,
  slug: string,
  now: Date,
  daysAgo: number,
): ApplicationSeed {
  return {
    key,
    clusterId,
    vacancy: syntheticVacancy(title, company, slug),
    stage: 'saved',
    createdAt: relativeDate(now, -daysAgo, 12),
  };
}

function ensureApplication(
  store: TodaySeedStore,
  candidateId: string,
  existingByCluster: Map<string | null, SeededApplication>,
  seed: ApplicationSeed,
): SeededApplication {
  const existing = existingByCluster.get(seed.clusterId);
  if (existing) return existing;

  const created = store.createApplication(candidateId, {
    clusterId: seed.clusterId,
    manualVacancy: seed.vacancy,
    stage: seed.stage,
    occurredAt: seed.createdAt,
  });
  existingByCluster.set(seed.clusterId, created);
  return created;
}

function ensureApplicationStage(
  store: TodaySeedStore,
  candidateId: string,
  existingByCluster: Map<string | null, SeededApplication>,
  seed: ApplicationSeed,
  application: SeededApplication,
  archiveStaleDays: number | undefined,
): SeededApplication {
  if (!seed.nextStage || application.stage === seed.nextStage) return application;

  const updated = store.patchApplication(
    candidateId,
    application.id,
    {
      expectedVersion: application.version,
      stage: seed.nextStage,
      occurredAt: seed.stageChangedAt ?? seed.createdAt,
    },
    archiveStaleDays,
  );
  existingByCluster.set(seed.clusterId, updated);
  return updated;
}

function ensureFollowUpDueAt(
  store: TodaySeedStore,
  candidateId: string,
  existingByCluster: Map<string | null, SeededApplication>,
  seed: ApplicationSeed,
  application: SeededApplication,
  archiveStaleDays: number | undefined,
): SeededApplication {
  if (!seed.followUpDueAt || application.followUpDueAt === seed.followUpDueAt) {
    return application;
  }

  const updated = store.patchApplication(
    candidateId,
    application.id,
    {
      expectedVersion: application.version,
      followUpDueAt: seed.followUpDueAt,
    },
    archiveStaleDays,
  );
  existingByCluster.set(seed.clusterId, updated);
  return updated;
}

function ensureInterview(
  store: TodaySeedStore,
  candidateId: string,
  seed: ApplicationSeed,
  application: SeededApplication,
): void {
  if (!seed.interviewAt || application.interviewScheduledAt.includes(seed.interviewAt)) return;
  store.createApplicationInterview(candidateId, application.id, {
    round: 2,
    scheduledAt: seed.interviewAt,
    format: 'video',
  });
}

export function seedBlockAToday(
  store: TodaySeedStore,
  candidateId: string,
  archiveStaleDays: number | undefined,
  now = new Date(),
) {
  const existingByCluster = new Map<string | null, SeededApplication>(
    store.listApplications(candidateId).map((application) => [application.clusterId, application]),
  );
  const applicationIds = {} as Record<ApplicationSeed['key'], string>;

  for (const seed of applicationSeeds(now)) {
    let application = ensureApplication(store, candidateId, existingByCluster, seed);
    application = ensureApplicationStage(
      store,
      candidateId,
      existingByCluster,
      seed,
      application,
      archiveStaleDays,
    );
    application = ensureFollowUpDueAt(
      store,
      candidateId,
      existingByCluster,
      seed,
      application,
      archiveStaleDays,
    );
    ensureInterview(store, candidateId, seed, application);
    applicationIds[seed.key] = application.id;
  }

  return { applicationIds, funnel: store.applicationFunnel(candidateId) };
}
