/** Declared synthetic historical findings for visual QA; never contacts any provider. */
import type { Page, Route } from '@playwright/test';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
  FootprintReview,
} from '../../shared/candidateFootprint';

const ROWS = [
  ['profile', 'Профиль на GitHub: andrey-lebedev', 'Совпадение по имени и городу'],
  ['mention', 'Доклад о платёжной архитектуре, 2023', 'Совпадение по имени и компании'],
  ['profile', 'Старый аккаунт на форуме разработчиков', 'Возможны однофамильцы'],
] as const;

export function historicalAudit(candidateId: string): CandidateFootprintAudit {
  const findings: CandidateFootprintFinding[] = ROWS.map(([kind, title, detail], index) => ({
    id: String(index + 1).padStart(24, '0'),
    adapter: 'synthetic_fixture',
    kind,
    title,
    detail,
    url: null,
    match: 'unknown',
    automatedMatch: 'unknown',
    review: 'unreviewed',
    observedAt: '2026-10-06T09:12:00.000Z',
    sources: ['synthetic_fixture'],
    receipt: {
      method: 'local_fixture',
      source: 'approved-mockup-synthetic-scenario',
      query: 'synthetic candidate',
    },
    receipts: [
      {
        method: 'local_fixture',
        source: 'approved-mockup-synthetic-scenario',
        query: 'synthetic candidate',
      },
    ],
  }));
  return {
    id: 'synthetic-historical-audit',
    candidateId,
    state: 'completed',
    findings,
    selectedQueryIds: [],
    // Mockup 2: «2 Сканирование — 4 источника, 06.10».
    adapterStatuses: (['sherlock', 'maigret', 'wayback', 'exa'] as const).map((adapterId) => ({
      adapterId,
      state: 'checked' as const,
      sourcesChecked: 1,
      findingsCount: 0,
    })),
    ownershipConfirmedAt: '2026-10-05T09:00:00.000Z',
    startedAt: '2026-10-06T09:00:00.000Z',
    completedAt: '2026-10-06T09:12:00.000Z',
  };
}

async function send(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'synthetic-footprint-qa' } }),
  });
}

async function denyNewScan(route: Route) {
  await route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 'consent_text_pending_approval',
        message: 'Текст нового согласия ещё не утверждён.',
        retryable: false,
      },
    }),
  });
}

export async function installBlockAFootprintFixture(page: Page, candidateId: string) {
  let audit: CandidateFootprintAudit | null = historicalAudit(candidateId);
  let granted = true;
  await page.route('**/api/v1/candidate/footprint**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/plan')) {
      await send(route, {
        plan: [],
        unidentifiedEmployers: [],
        sourceAvailability: {
          sherlock: false,
          maigret: false,
          hibp: false,
          wayback: false,
          exa: false,
        },
        consent: { approved: false, granted, versionId: 'synthetic-historical-consent' },
        audit,
      });
    } else if (method === 'DELETE') {
      audit = null;
      await send(route, { deleted: true });
    } else if (method === 'PATCH' && audit) {
      const id = url.pathname.split('/').at(-1);
      const review: unknown = route.request().postDataJSON().review;
      if (!['unreviewed', 'confirmed_self', 'not_self', 'hidden'].includes(String(review)))
        throw new Error('Invalid fixture review');
      audit = {
        ...audit,
        findings: audit.findings.map((finding) =>
          finding.id === id ? { ...finding, review: review as FootprintReview } : finding,
        ),
      };
      await send(route, { audit });
    } else if (method === 'GET') await send(route, { audit });
    else await denyNewScan(route);
  });
  await page.route('**/api/v1/me/consents/digital_footprint', async (route) => {
    if (route.request().method() === 'DELETE') {
      granted = false;
      audit = null;
      await send(route, { granted: false, revoked: true });
    } else await denyNewScan(route);
  });
}
