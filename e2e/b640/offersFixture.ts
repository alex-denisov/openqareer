import type { Page, Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

type Json = Record<string, unknown>;

export interface OffersMockOptions {
  /** Без офферов — пустое состояние O6b. */
  readonly empty?: boolean;
  /** Сколько первых записей решения ответить ошибкой 500. */
  readonly failDecision?: number;
  /** Сколько первых сохранений условий ответить ошибкой 500. */
  readonly failSave?: number;
}

export interface OffersMock {
  readonly calls: string[];
}

const NOW = '2026-11-10T09:00:00.000Z';

function application(id: string, title: string, company: string): Json {
  return {
    id,
    candidateId: 'candidate-fixture',
    clusterId: `cluster-${id}`,
    stage: 'offer',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: { title, company, url: '', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    appliedAt: NOW,
    reachedStages: ['applied', 'interview', 'offer'],
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    deliveryReceipt: null,
    deliveryReceiptRecordedAt: null,
    interviewScheduledAt: [],
  };
}

interface OfferState {
  terms: Json;
  respondBy: string | null;
  taxPercent: number | null;
  decision: string | null;
}

function seed(): Map<string, OfferState> {
  return new Map([
    [
      'o-vector',
      {
        terms: {
          baseSalary: 520_000,
          salaryPeriod: 'month',
          currency: 'RUB',
          bonus: 1_040_000,
          format: 'Гибрид, 2 дня в офисе',
          startDate: '2026-12-01',
          probationPeriodMonths: 3,
          probationSalary: 500_000,
          benefits: ['ДМС со стоматологией', 'оплата спорта'],
          risks: ['Премия не гарантирована'],
          sourceNote: 'с ваших слов',
        },
        respondBy: '2026-11-14',
        taxPercent: 0,
        decision: null,
      },
    ],
    [
      'o-green',
      {
        terms: {
          baseSalary: 6_500,
          salaryPeriod: 'month',
          currency: 'USD',
          bonus: 0,
          format: 'remote',
          startDate: '2026-12-15',
        },
        respondBy: '2026-11-18',
        taxPercent: null,
        decision: null,
      },
    ],
  ]);
}

function view(id: string, offer: OfferState): Json {
  const amount = typeof offer.terms.baseSalary === 'number' ? offer.terms.baseSalary : null;
  const net =
    amount !== null && offer.taxPercent !== null
      ? Math.round(amount * (1 - offer.taxPercent / 100))
      : null;
  return {
    applicationId: id,
    gross: {
      amount,
      period: offer.terms.salaryPeriod ?? null,
      currency: offer.terms.currency ?? null,
    },
    taxPercent: offer.taxPercent,
    net,
    respondBy: offer.respondBy,
    daysLeft: 4,
    deadline: 'later',
    decision: offer.decision,
    decidedAt: offer.decision ? NOW : null,
  };
}

function stored(id: string, offer: OfferState): Json {
  return {
    applicationId: id,
    terms: offer.terms,
    respondBy: offer.respondBy,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function failOnce(route: Route, left: { n: number }): Promise<boolean> {
  if (left.n <= 0) return false;
  left.n -= 1;
  await route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'Сбой' } } });
  return true;
}

/** «Офферы» B640: Вектор Банк (на руки, ₽) и Гринкод ($ до налога), курс ЦБ и планка 400 тыс. ₽. */
export async function mockOffers(page: Page, options: OffersMockOptions = {}): Promise<OffersMock> {
  const offers = options.empty ? new Map<string, OfferState>() : seed();
  const applications = options.empty
    ? []
    : [
        application('o-vector', 'Руководитель разработки', 'Вектор Банк'),
        application('o-green', 'Head of Engineering', 'Гринкод'),
      ];
  const calls: string[] = [];
  const decisionFails = { n: options.failDecision ?? 0 };
  const saveFails = { n: options.failSave ?? 0 };

  await mockSignedInCabinet(page, {
    cabinetB640: true,
    billing: { initialPlan: 'pro' },
    applicationHandler: async (route: Route, path: string) => {
      const method = route.request().method();
      if (path === '/api/v1/candidate/applications' && method === 'GET') {
        await route.fulfill({
          json: {
            data: applications,
            meta: { total: applications.length, offset: 0, limit: 100, stageCounts: {} },
          },
        });
        return true;
      }
      if (path === '/api/v1/candidate/applications' && method === 'POST') {
        const body = route.request().postDataJSON() as {
          manualVacancy: { title: string; company: string };
        };
        const created = application(
          `o-new-${applications.length}`,
          body.manualVacancy.title,
          body.manualVacancy.company,
        );
        applications.push(created);
        calls.push(`POST applications ${body.manualVacancy.company}`);
        await route.fulfill({ status: 201, json: { data: created } });
        return true;
      }
      if (path === '/api/v1/candidate/applications/offers') {
        await route.fulfill({
          json: { data: [...offers].map(([id, offer]) => stored(id, offer)) },
        });
        return true;
      }
      const match = path.match(/^\/api\/v1\/candidate\/applications\/([^/]+)\/offer$/u);
      if (match && method === 'PUT') {
        if (await failOnce(route, saveFails)) return true;
        const id = decodeURIComponent(match[1]!);
        const body = route.request().postDataJSON() as { terms: Json; respondBy: string | null };
        const offer = {
          ...(offers.get(id) ?? { taxPercent: null, decision: null }),
          terms: body.terms,
          respondBy: body.respondBy,
        };
        offers.set(id, offer);
        calls.push(`PUT offer ${id} ${JSON.stringify(body)}`);
        await route.fulfill({ json: { data: stored(id, offer) } });
        return true;
      }
      return false;
    },
  });

  await page.route('**/api/v1/candidate/currency-rates', (route) =>
    route.fulfill({ json: { data: { date: '2026-11-10', rubPerUnit: { USD: 90.8, EUR: 98.4 } } } }),
  );
  await page.route('**/api/v1/candidate/decision-profile', (route) =>
    route.fulfill({ json: { data: { salaryFloor: 400_000, salaryCurrency: 'RUB' } } }),
  );
  await page.route('**/api/v1/candidate/b640/offers**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/b640/offers') && method === 'GET') {
      await route.fulfill({ json: { data: [...offers].map(([id, offer]) => view(id, offer)) } });
      return;
    }
    const match = path.match(/\/b640\/offers\/([^/]+)\/(tax|decision)$/u);
    const id = match ? decodeURIComponent(match[1]!) : '';
    const offer = offers.get(id);
    if (!match || !offer) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'offer_not_found', message: 'Нет оффера' } },
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      taxPercent?: number | null;
      decision?: string | null;
    };
    calls.push(`PUT ${match[2]} ${id} ${JSON.stringify(body)}`);
    if (match[2] === 'tax') {
      offer.taxPercent = body.taxPercent ?? null;
      await route.fulfill({ json: { data: view(id, offer) } });
      return;
    }
    if (await failOnce(route, decisionFails)) return;
    offer.decision = body.decision ?? null;
    await route.fulfill({
      json: {
        data: {
          offer: view(id, offer),
          proposeStatus: offer.decision === 'accepted' ? 'working' : null,
        },
      },
    });
  });
  return { calls };
}
