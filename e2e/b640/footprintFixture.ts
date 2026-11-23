import type { Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/** Свои данные следа для B652: прод-находки adenisov.test удалены 17.11. */
const API = '**/api/v1';
const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
const qid = (n: number) => hex(n, 20);
export const fid = (n: number) => hex(n, 24);

const PLAN = [
  {
    id: qid(1),
    adapterId: 'exa',
    kind: 'name',
    preview: 'Имя и фамилия: Марина Соколова',
    selectedByDefault: true,
    available: true,
  },
  {
    id: qid(2),
    adapterId: 'hibp',
    kind: 'email',
    preview: 'Почта m***@mail.ru',
    selectedByDefault: true,
    available: true,
  },
  {
    id: qid(3),
    adapterId: 'sherlock',
    kind: 'profile_url',
    preview: 'Ссылка github.com/msokolova',
    selectedByDefault: true,
    available: true,
  },
  {
    id: qid(4),
    adapterId: 'maigret',
    kind: 'profile_url',
    preview: 'Ссылка github.com/msokolova',
    selectedByDefault: true,
    available: true,
  },
  {
    id: qid(5),
    adapterId: 'wayback',
    kind: 'profile_url',
    preview: 'Ссылка habr.com/users/msokolova',
    selectedByDefault: true,
    available: true,
  },
];

type Level = 'high' | 'important' | 'low' | 'useful';
const LABEL: Record<Level, string> = {
  high: 'высокий риск',
  important: 'важно',
  low: 'низкий риск',
  useful: 'полезно',
};

function item(
  n: number,
  category: string,
  level: Level,
  title: string,
  detail: string,
  action: [string, string] | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: fid(n),
    category,
    level,
    levelLabel: LABEL[level],
    title,
    detail,
    url: `https://example.org/${n}`,
    observedAt: '2026-11-10T09:00:00.000Z',
    resolved: false,
    action: action ? { kind: action[0], label: action[1] } : null,
    findingId: fid(n),
    mismatch: null,
    ...extra,
  };
}

const RISKY = [
  item(
    1,
    'personal_data',
    'high',
    'Почта на двух старых сервисах',
    'Книжный клуб, 2021 · сервис доставки, 2023',
    ['close_account', 'Закрыть аккаунты'],
    { levelReason: 'старые аккаунты на эту почту ещё открыты' },
  ),
  item(2, 'needs_check', 'important', 'Профиль под вашим ником', 'Сайт знакомств, 2022', [
    'check_now',
    'Проверить',
  ]),
  {
    ...item(
      3,
      'resume_mismatch',
      'low',
      'Должность на сайте конференции',
      '2023 · «тимлид», в резюме — руководитель группы',
      ['ask_to_fix', 'Попросить исправить'],
    ),
    id: 'mismatch:m1',
    findingId: null,
    mismatch: {
      field: 'Должность',
      profileValue: 'руководитель группы разработки',
      foundValue: 'тимлид',
    },
  },
  item(
    4,
    'stale_profile',
    'low',
    'Профиль на Мой Круг',
    '2016 · последняя должность — ведущий разработчик',
    ['hide', 'Скрыть'],
  ),
];
const USEFUL = [
  item(5, 'useful_evidence', 'useful', 'Профиль на GitHub', '14 проектов, последний — 2024', [
    'add_to_profile',
    'В профиль',
  ]),
  item(
    6,
    'useful_evidence',
    'useful',
    'Выступление на конференции',
    'Видео, 2023 · платформа релизов',
    ['add_to_profile', 'В профиль'],
  ),
];

/** B727: страница по нику без подтверждения — «Нужно проверить», «Проверить» открывает её. */
export const NICK_URL = 'https://www.duolingo.com/profile/alexey_denisov';
const NICK = {
  ...item(
    7,
    'needs_check',
    'important',
    'Duolingo',
    'duolingo.com/profile/alexey_denisov · Открытая страница найдена по нику.',
    ['confirm_owner', 'Проверить'],
  ),
  url: NICK_URL,
};

const TITLES: Record<string, string> = {
  personal_data: 'Личные данные открыты',
  needs_check: 'Нужно проверить сейчас',
  resume_mismatch: 'Расхождения с резюме',
  stale_profile: 'Устаревшие профили',
  useful_evidence: 'Полезные доказательства',
};

function summary(state: string, items: ReturnType<typeof item>[], headline: string | null) {
  const categories = Object.entries(TITLES).map(([id, title]) => {
    const own = items.filter((entry) => entry.category === id);
    const level = (own[0]?.level ?? null) as Level | null;
    return {
      id,
      title,
      count: own.length,
      level,
      levelLabel: level ? LABEL[level] : null,
      where: own
        .slice(0, 2)
        .map((entry) => entry.title)
        .join(' · '),
    };
  });
  const toRemove = items.filter((entry) => entry.level !== 'useful').length;
  return {
    state,
    checkedAt: state === 'ready' ? '2026-11-11T09:00:00.000Z' : null,
    total: items.length,
    toRemove,
    headline,
    categories,
    items,
  };
}

export type FootprintCase = 'fresh' | 'ready' | 'nothing' | 'checking' | 'failed' | 'nick';

function caseSummary(kind: FootprintCase) {
  if (kind === 'ready') return summary('ready', [...RISKY, ...USEFUL], '6 находок, 4 стоит убрать');
  if (kind === 'nothing') return summary('ready', USEFUL, '2 находки, ничего рискового');
  if (kind === 'nick')
    return summary('ready', [...RISKY, NICK, ...USEFUL], '7 находок, 5 стоит убрать');
  if (kind === 'checking') return summary('checking', [], null);
  if (kind === 'failed') return summary('failed', [], null);
  return summary('not_checked', [], null);
}

function caseAudit(kind: FootprintCase) {
  if (kind === 'fresh') return null;
  const pending = kind === 'checking';
  return {
    id: 'a1',
    candidateId: 'c1',
    state: pending ? 'pending' : kind === 'failed' ? 'failed' : 'completed',
    selectedQueryIds: PLAN.map((entry) => entry.id),
    adapterStatuses: ['exa', 'hibp', 'sherlock', 'maigret', 'wayback'].map((adapterId, index) => ({
      adapterId,
      sourcesChecked: 1,
      findingsCount: 0,
      state:
        pending && index >= 2
          ? 'pending'
          : kind === 'failed' && index < 2
            ? 'source_error'
            : 'checked',
    })),
    findings: [],
    ownershipConfirmedAt: '2026-11-10T09:00:00.000Z',
    startedAt: '2026-11-10T09:00:00.000Z',
  };
}

export interface FootprintCalls {
  readonly started: unknown[];
  readonly reviews: Array<{ id: string; review: string }>;
  /** B645 p02: «Это не проблема» у расхождения с резюме и её отмена. */
  readonly mismatches: Array<{ id: string; review: string }>;
  readonly granted: string[];
  revoked: number;
  /** B382: «Письмо отправлено» и «Проверить находку» по id находки. */
  readonly removals: string[];
  readonly rechecks: string[];
}

type Removal = { requestedAt?: string; checkedAt?: string; result?: string };

/** Сводка с сохранённым путём удаления: «удалено» снимает находку из «стоит убрать». */
function withRemovals(data: ReturnType<typeof caseSummary>, removals: Map<string, Removal>) {
  const items = data.items.map((entry) => {
    const removal = removals.get(entry.id);
    if (!removal) return entry;
    const resolved = removal.result === 'removed';
    return { ...entry, removal, resolved, action: resolved ? null : entry.action };
  });
  return { ...data, items };
}

/** «Это не моё» (B727): как на сервере, отвергнутая находка уходит из сводки. */
function withoutRejected(data: ReturnType<typeof caseSummary>, calls: FootprintCalls) {
  const last = new Map(calls.reviews.map((entry) => [entry.id, entry.review]));
  // Как на сервере: отмеченное «Это не проблема» расхождение уходит из сводки до отмены.
  const mismatch = new Map(calls.mismatches.map((entry) => [entry.id, entry.review]));
  const items = data.items.filter(
    (entry) =>
      last.get(entry.findingId ?? '') !== 'not_self' && mismatch.get(entry.id) !== 'hidden',
  );
  return { ...data, items };
}

async function mockRemoval(
  page: Page,
  calls: FootprintCalls,
  removals: Map<string, Removal>,
  recheckResult: string,
): Promise<void> {
  await page.route(`${API}/candidate/footprint/findings/*/removal-request`, (route) => {
    const id = route.request().url().split('/').at(-2) ?? '';
    calls.removals.push(id);
    const removal = { ...removals.get(id), requestedAt: '2026-11-18T09:00:00.000Z' };
    removals.set(id, removal);
    return route.fulfill({ json: { data: { findingId: id, removal } } });
  });
  await page.route(`${API}/candidate/footprint/findings/*/recheck`, (route) => {
    const id = route.request().url().split('/').at(-2) ?? '';
    calls.rechecks.push(id);
    const removal = {
      ...removals.get(id),
      checkedAt: '2026-11-19T09:00:00.000Z',
      result: recheckResult,
    };
    removals.set(id, removal);
    return route.fulfill({ json: { data: { findingId: id, removal } } });
  });
}

/** Кабинет под флагом с моками маршрутов следа; состояние меняется вызовами экрана. */
export async function openFootprint(
  page: Page,
  path: string,
  initial: FootprintCase,
  recheckResult = 'removed',
): Promise<FootprintCalls> {
  const calls: FootprintCalls = {
    started: [],
    reviews: [],
    mismatches: [],
    granted: [],
    revoked: 0,
    removals: [],
    rechecks: [],
  };
  const removals = new Map<string, Removal>();
  let kind = initial;
  let granted = initial !== 'fresh';
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/candidate/footprint/plan`, (route) =>
    route.fulfill({
      json: {
        data: {
          plan: PLAN,
          sourceAvailability: {},
          consent: { approved: true, granted, versionId: 'digital_footprint-v1.1' },
          audit: caseAudit(kind),
        },
      },
    }),
  );
  await page.route(`${API}/candidate/footprint/risks`, (route) =>
    route.fulfill({
      json: { data: withoutRejected(withRemovals(caseSummary(kind), removals), calls) },
    }),
  );
  await mockRemoval(page, calls, removals, recheckResult);
  await page.route(`${API}/candidate/footprint/start`, (route) => {
    calls.started.push(route.request().postDataJSON());
    kind = 'checking';
    return route.fulfill({ status: 202, json: { data: { audit: caseAudit('checking') } } });
  });
  await page.route(`${API}/candidate/footprint/mismatches/*`, (route) => {
    const id = decodeURIComponent(route.request().url().split('/').pop() ?? '');
    const review = (route.request().postDataJSON() as { review: string }).review;
    calls.mismatches.push({ id, review });
    return route.fulfill({ json: { data: { id, review } } });
  });
  await page.route(`${API}/candidate/footprint/findings/*`, (route) => {
    const id = route.request().url().split('/').pop() ?? '';
    calls.reviews.push({
      id,
      review: (route.request().postDataJSON() as { review: string }).review,
    });
    return route.fulfill({ json: { data: { audit: caseAudit('ready') } } });
  });
  await page.route(`${API}/me/consents`, (route) =>
    route.fulfill({
      json: {
        data: {
          consents: granted
            ? [
                {
                  id: 'k1',
                  capability: 'digital_footprint',
                  versionId: 'v',
                  grantedAt: '2026-11-10T08:00:00.000Z',
                  revokedAt: null,
                },
              ]
            : [],
        },
      },
    }),
  );
  await page.route(`${API}/me/consents/digital_footprint`, (route) => {
    if (route.request().method() === 'DELETE') {
      calls.revoked += 1;
      granted = false;
      kind = 'fresh';
      return route.fulfill({ json: { data: { consent: null } } });
    }
    calls.granted.push((route.request().postDataJSON() as { versionId: string }).versionId);
    granted = true;
    return route.fulfill({
      json: {
        data: {
          consent: {
            id: 'k1',
            capability: 'digital_footprint',
            versionId: 'v',
            grantedAt: '2026-11-18T08:00:00.000Z',
            revokedAt: null,
          },
        },
      },
    });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return calls;
}

/** Ответ сервера переводит поиск из «идёт» в готовый — для проверки опроса. */
export function finishSearch(page: Page): Promise<void> {
  return page.route(`${API}/candidate/footprint/risks`, (route) =>
    route.fulfill({ json: { data: caseSummary('ready') } }),
  );
}
