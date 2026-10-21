import { chooseStrategyRole } from '../../shared/careerStrategy';
/**
 * B510: puts one synthetic candidate of the block C demo into the real stores.
 * Store writes use the same methods the product uses; wants and contacts go
 * through the HTTP routes after the app is built, so validation stays real.
 */
import type { FastifyInstance } from 'fastify';
import type { CandidateStore } from '../../server/data/candidateStore';
import type { SqliteRecruiterContactsRepository } from '../../server/data/sqliteRecruiterContactsRepository';
import type { UnifiedVacancy } from '../../server/domain/unifiedVacancy';
import { candidateCompanyKey } from '../../server/domain/candidateCompanies';

export const BLOCK_C_MAIN_ROLES = [
  'Head of Engineering',
  'Director of Engineering',
  'Head of Platform Engineering',
] as const;
/** Few salaries are stated for these, so the market estimate reads «мало данных». */
export const BLOCK_C_FEW_DATA_ROLES = [
  'Head of Data Engineering',
  'Head of QA Engineering',
] as const;
/** No catalog row carries this title: the matched pool is honestly empty. */
export const BLOCK_C_EMPTY_ROLES = ['Chief Astronomy Officer'] as const;

export const BLOCK_C_VECTOR_CLUSTER = 'cluster-bc-vector-head-payments';
/** Top rows of the mockup that get a ready fit breakdown in `default`. */
export const BLOCK_C_FIT_CLUSTERS = [
  BLOCK_C_VECTOR_CLUSTER,
  'cluster-bc-greencode-director',
  'cluster-bc-arka-platform',
  'cluster-bc-oblako-head',
] as const;
const SAVED_COUNT = 18;
const CLOSED_COUNT = 2;
const WANTED_COMPANIES = ['Гринкод', 'Сфера Пэй', 'Квант Дата'];

export interface BlockCCandidateSeed {
  readonly roles: readonly string[];
  readonly saved: boolean;
}

export function seedBlockCCandidate(
  store: CandidateStore,
  candidateId: string,
  seed: BlockCCandidateSeed,
  now: Date,
): void {
  // Memory ids are unique across candidates in one database.
  const memoryId = (name: string) => `bc-${name}-${candidateId}`;
  store.importResumeEvidence(candidateId, {
    sourceLabel: 'Импорт: профиль LinkedIn (синтетический набор блока C)',
    platform: 'linkedin',
    entries: [
      { memoryId: memoryId('management'), domain: 'skill', statement: 'Engineering management' },
      { memoryId: memoryId('payments'), domain: 'skill', statement: 'Платёжные системы' },
      { memoryId: memoryId('java'), domain: 'skill', statement: 'Java' },
    ],
  });
  for (const name of ['management', 'payments']) {
    store.changeMemory(candidateId, memoryId(name), { action: 'confirm' });
  }
  store.saveCandidateWorkspace(candidateId, {
    careerGoal: 'find-job',
    resumeText: '',
    resumeSource: 'text',
    resumeImported: true,
    targetDirection: seed.roles[0] ?? '',
    regions: [],
    currentSituation: 'Синтетический профиль для локальной проверки блока C.',
    constraints: '',
    urgency: 'active',
    campaign: {
      roles: [...seed.roles],
      // «Москва +46» in the mockup: Russia is the chosen market, abroad rows are marked outside it.
      regions: ['ru'],
      revision: 1,
      updatedAt: now.toISOString(),
    },
  });
  seedBlockCStrategy(store, candidateId, now);
}

/** B446-g4: выбранная целевая роль, как в макете 4 — иначе квиз пишет «после выбора роли». */
function seedBlockCStrategy(store: CandidateStore, candidateId: string, now: Date): void {
  const chosen = chooseStrategyRole({
    previous: null,
    role: {
      title: 'Head of Engineering',
      origin: 'candidate',
      reason: 'Синтетический выбор стенда блока C',
      evidenceRefs: [],
      confirmation: { state: 'observed', sampleSize: 312 },
    },
    constraints: { regions: ['ru'], note: null },
    reason: null,
    decidedAt: now.toISOString(),
    provenance: { namedBy: 'candidate', language: 'ru', poolSize: 312 },
  });
  if (chosen.ok) store.saveCareerStrategy(candidateId, chosen.strategy);
}

/** Saved = applications at stage `saved`; the first is the Вектор Банк row of the mockup. */
export function savedBlockCVacancies(rows: readonly UnifiedVacancy[]): UnifiedVacancy[] {
  const head = rows.filter((row) => /Head|Director|Руководитель/u.test(row.title));
  const featured = head.find((row) => `cluster-${row.id}` === BLOCK_C_VECTOR_CLUSTER);
  const rest = head.filter((row) => row !== featured && !row.id.startsWith('bc-greencode'));
  return [...(featured ? [featured] : []), ...rest.slice(0, SAVED_COUNT - 1)];
}

/** The last saved rows were closed on their platform: the pool keeps the date of closing. */
export function closedBlockCVacancies(saved: readonly UnifiedVacancy[]): UnifiedVacancy[] {
  return saved.slice(-CLOSED_COUNT);
}

export function seedBlockCSaved(
  store: CandidateStore,
  candidateId: string,
  saved: readonly UnifiedVacancy[],
  now: Date,
): void {
  saved.forEach((row, index) => {
    store.createApplication(candidateId, {
      clusterId: `cluster-${row.id}`,
      vacancy: {
        title: row.title,
        company: row.company,
        url: row.url,
        source: row.provenance.sourceName ?? row.provenance.sourceId,
      },
      stage: 'saved',
      occurredAt: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString(),
    });
  });
}

/** Contact ids are unique across candidates in one database, so each carries the candidate. */
export function blockCRecruiterId(candidateId: string): string {
  return `bc-recruiter-vector-${candidateId}`;
}

export function seedBlockCRecruiter(
  repo: SqliteRecruiterContactsRepository,
  candidateId: string,
  now: Date,
): void {
  const at = now.toISOString();
  repo.saveContacts(candidateId, BLOCK_C_VECTOR_CLUSTER, [
    {
      id: blockCRecruiterId(candidateId),
      vacancyId: BLOCK_C_VECTOR_CLUSTER,
      companyName: 'Вектор Банк',
      fullName: 'Мария Синтетова',
      roleTitle: 'IT Recruiter',
      email: null,
      emailStatus: 'unverified',
      phone: null,
      telegram: null,
      whatsapp: null,
      linkedinUrl: 'https://www.linkedin.com/in/block-c-recruiter-example',
      githubUrl: null,
      twitterUrl: null,
      sourceType: 'vacancy_text',
      confidence: 0.7,
      createdAt: at,
      updatedAt: at,
    },
  ]);
}

interface ConnectionSeed {
  readonly id: string;
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly relationship: string;
  readonly strength: 'strong' | 'weak' | 'unknown';
  readonly knowsRecruiterIds: readonly string[];
}

/** Two first-circle contacts at Вектор Банк and one second-circle path through the recruiter. */
const CONNECTIONS: readonly ConnectionSeed[] = [
  {
    id: 'bc-contact-1',
    fullName: 'Илья Примеров',
    companyName: 'Вектор Банк',
    roleTitle: 'Engineering Manager',
    relationship: 'Бывший коллега по Финтех Лаб',
    strength: 'strong',
    knowsRecruiterIds: [],
  },
  {
    id: 'bc-contact-2',
    fullName: 'Ольга Тестова',
    companyName: 'Вектор Банк',
    roleTitle: 'Product Director',
    relationship: 'Знакомы по конференции',
    strength: 'weak',
    knowsRecruiterIds: [],
  },
  {
    id: 'bc-contact-3',
    fullName: 'Пётр Образцов',
    companyName: 'Гринкод',
    roleTitle: 'CTO',
    relationship: 'Бывший руководитель',
    strength: 'strong',
    knowsRecruiterIds: ['recruiter'],
  },
];

async function put(
  app: FastifyInstance,
  token: string,
  origin: string,
  url: string,
  payload: unknown,
) {
  const response = await app.inject({
    method: 'PUT',
    url,
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    payload: JSON.stringify(payload ?? {}),
  });
  if (response.statusCode >= 400) {
    throw new Error(`block C seed ${url} → ${response.statusCode}: ${response.body.slice(0, 300)}`);
  }
}

export async function seedBlockCThroughRoutes(
  app: FastifyInstance,
  candidateId: string,
  token: string,
  origin: string,
  options: { readonly contacts: boolean; readonly wants: boolean },
): Promise<void> {
  for (const company of options.wants ? WANTED_COMPANIES : []) {
    await put(
      app,
      token,
      origin,
      `/api/v1/candidate/companies/${candidateCompanyKey(company)}/want`,
      {},
    );
  }
  if (!options.contacts) return;
  for (const { id, ...contact } of CONNECTIONS) {
    await put(app, token, origin, `/api/v1/candidate/connection-contacts/${id}-${candidateId}`, {
      ...contact,
      knowsRecruiterIds: contact.knowsRecruiterIds.map(() => blockCRecruiterId(candidateId)),
      workplaces: [],
    });
  }
}
