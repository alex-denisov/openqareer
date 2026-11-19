import type { Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/** Свои данные «Карьеры» для B653: роли по профилю, кампания, условия поиска. */
const API = '**/api/v1';

function observed(
  id: string,
  title: string,
  sampleSize: number,
  wage: { min: number; max: number; sampleSize: number } | null,
  matched: string[],
) {
  return {
    id,
    title,
    origin: 'model',
    reason: null,
    evidenceRefs: [],
    family: null,
    confirmation: {
      state: 'observed',
      sampleSize,
      observedFrom: '2026-10-11',
      observedTo: '2026-11-10T09:00:00.000Z',
      sources: [{ source: 'hh', count: sampleSize }],
      repeatedRequirements: ['Управление командой', 'Бюджет', 'Найм'],
      matchedRequirementNames: matched,
      ...(wage ? { wage } : {}),
    },
  };
}

const notFound = (id: string, title: string) => ({
  id,
  title,
  origin: 'model',
  reason: null,
  evidenceRefs: [],
  family: null,
  confirmation: { state: 'not-found' },
});

const ROLES = [
  observed('r1', 'Руководитель разработки', 64, { min: 380_000, max: 520_000, sampleSize: 96 }, [
    'Управление командой',
  ]),
  observed(
    'r2',
    'Технический продакт-менеджер',
    41,
    { min: 350_000, max: 420_000, sampleSize: 24 },
    ['Управление командой', 'Бюджет'],
  ),
  observed('r3', 'Директор по разработке', 31, { min: 600_000, max: 750_000, sampleSize: 31 }, []),
  notFound('r4', 'Head of Platform'),
  notFound('r5', 'Руководитель платформы'),
];

export interface CareerCalls {
  readonly campaigns: unknown[];
  readonly profiles: Array<Record<string, unknown>>;
  readonly stopAdded: string[];
  readonly stopRemoved: string[];
  readonly ownRoles: unknown[];
  readonly lowerIncome: unknown[];
  readonly growthGoals: unknown[];
}

export interface CareerOptions {
  readonly status?: string;
  readonly searchRoles?: string[];
  readonly failProfileSave?: boolean;
  /** Ответ пути в профессию (S11); без него — «цель не выбрана». */
  readonly professionPath?: unknown;
  /** Нынешний доход на руки из профиля. */
  readonly income?: number | null;
  /** Ответ цели роста (S12); выбор цели возвращает `growthAfter`, если он задан. */
  readonly growth?: unknown;
  readonly growthAfter?: unknown;
}

function campaign(roles: string[]) {
  return {
    roles: { value: roles, origin: 'explicit' },
    regions: { value: [], origin: 'default' },
    remoteOnly: false,
  };
}

function statusState(status: string) {
  return {
    current: {
      status,
      label: status,
      title: status,
      targetProfession: null,
      since: null,
      chosen: true,
    },
    statuses: [],
    history: [],
    revert: null,
  };
}

/** Кабинет под флагом с моками «Карьеры»; записи экрана копятся в `calls`. */
export async function openCareer(
  page: Page,
  path: string,
  options: CareerOptions = {},
): Promise<CareerCalls> {
  const calls: CareerCalls = {
    campaigns: [],
    profiles: [],
    stopAdded: [],
    stopRemoved: [],
    ownRoles: [],
    lowerIncome: [],
    growthGoals: [],
  };
  let roles = options.searchRoles ?? ['Руководитель разработки'];
  let profile: Record<string, unknown> = {
    citizenship: ['РФ'],
    searchLocations: ['Москва', 'Удалённо из РФ'],
    languages: [],
    workFormats: ['home_market', 'remote_home'],
    salaryFloor: 500_000,
    salaryCurrency: 'RUB',
    hasFamily: false,
  };
  let stop = [{ company: 'Гринкод', origin: 'manual' }];
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/candidate/role-hypotheses`, (route) =>
    route.fulfill({ json: { data: ROLES } }),
  );
  await page.route(`${API}/candidate/campaign`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { roles: string[] };
      calls.campaigns.push(body);
      roles = body.roles;
    }
    return route.fulfill({ json: { data: campaign(roles) } });
  });
  await page.route(`${API}/candidate/career-roles`, (route) => {
    const body = route.request().postDataJSON() as { title: string };
    calls.ownRoles.push(body);
    roles = [...roles, body.title];
    return route.fulfill({ json: { data: campaign(roles) } });
  });
  await page.route(`${API}/candidate/role-skill-assessments/checked-roles`, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            roleTitle: 'Технический продакт-менеджер',
            completedAt: '2026-11-09',
            confirmedSkills: ['Найм'],
          },
        ],
      },
    }),
  );
  await page.route(`${API}/candidate/role-skill-demand`, (route) =>
    route.fulfill({
      json: {
        data: {
          state: 'ready',
          roles: [
            {
              roleTitle: 'Руководитель разработки',
              sampleSize: 64,
              observedAt: '2026-11-10T09:00:00.000Z',
              skills: [
                { name: 'Kubernetes', vacancies: 30, inProfile: false },
                { name: 'Бюджет', vacancies: 20, inProfile: false },
                { name: 'Найм', vacancies: 18, inProfile: false },
                { name: 'Go', vacancies: 12, inProfile: true },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.route(`${API}/candidate/status`, (route) =>
    route.fulfill({ json: { data: statusState(options.status ?? 'job_search') } }),
  );
  await page.route(`${API}/candidate/decision-profile`, (route) => {
    if (route.request().method() === 'PUT') {
      if (options.failProfileSave) return route.fulfill({ status: 503, json: { error: 'down' } });
      profile = route.request().postDataJSON() as Record<string, unknown>;
      calls.profiles.push(profile);
    }
    return route.fulfill({ json: { data: profile } });
  });
  await page.route(`${API}/candidate/automation/stop-companies`, (route) => {
    const method = route.request().method();
    if (method !== 'GET') {
      const { company } = route.request().postDataJSON() as { company: string };
      if (method === 'POST') {
        calls.stopAdded.push(company);
        stop = [...stop, { company, origin: 'manual' }];
      } else {
        calls.stopRemoved.push(company);
        stop = stop.filter((row) => row.company !== company);
      }
    }
    return route.fulfill({ json: { data: { stopCompanies: stop } } });
  });
  await page.route(`${API}/candidate/career/profession-path`, (route) =>
    route.fulfill({ json: { data: options.professionPath ?? { state: 'no_target' } } }),
  );
  await page.route(`${API}/candidate/career/profession-path/lower-income`, (route) => {
    const body = route.request().postDataJSON() as { answer: string };
    calls.lowerIncome.push(body);
    return route.fulfill({ json: { data: { lowerIncome: body.answer } } });
  });
  await page.route(`${API}/candidate/profile/income`, (route) =>
    route.fulfill({ json: { data: { current: options.income ?? null, expected: null } } }),
  );
  let growth = options.growth ?? { state: 'no_workplace' };
  await page.route(`${API}/candidate/career/growth`, (route) =>
    route.fulfill({ json: { data: growth } }),
  );
  await page.route(`${API}/candidate/career/growth/goal`, (route) => {
    const body = route.request().postDataJSON() as { goal: string };
    calls.growthGoals.push(body);
    if (options.growthAfter) growth = options.growthAfter;
    const goal = { kind: body.goal, chosenAt: '2026-11-19T09:00:00.000Z' };
    return route.fulfill({ json: { data: { goal } } });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return calls;
}
