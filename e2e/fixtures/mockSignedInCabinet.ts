import type { Page } from '@playwright/test';
import { mockCandidateCompanies } from './mockCandidateCompanies';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
  workspace,
} from './readabilityWorkspace';

type FixturePaidPlan = 'basic' | 'pro' | 'max';
type FixtureCurrentPlan = 'free' | FixturePaidPlan;
type FixtureCheckoutStatus = 'pending' | 'processing' | 'paid' | 'failed';
type FixtureExecutiveStatus = 'submitted' | 'waitlisted';

interface FixtureInvoice {
  readonly invoiceId: number;
  readonly planId: FixturePaidPlan;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly status: FixtureCheckoutStatus;
  readonly autoRenew: boolean;
  readonly paymentUrl: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

interface FixtureReceipt {
  readonly invoiceId: number;
  readonly planId: FixturePaidPlan;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly receiptUrl: string | null;
  readonly receiptStatus: string | null;
  readonly fiscalDocumentNumber: string | null;
  readonly fiscalDate: string | null;
}

export interface MockSignedInCabinetOptions {
  readonly billing?: {
    readonly initialPlan?: FixtureCurrentPlan;
    readonly checkoutStatuses?: readonly FixtureCheckoutStatus[];
    readonly executiveStatus?: FixtureExecutiveStatus;
  };
}

export async function mockSignedInCabinet(
  page: Page,
  options: MockSignedInCabinetOptions = {},
): Promise<string[]> {
  const unmatched: string[] = [];
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  let billingCurrentPlan: FixtureCurrentPlan = options.billing?.initialPlan ?? 'basic';
  let billingAutoRenew = billingCurrentPlan !== 'free';
  let billingPeriodEnd = '2026-11-08T00:00:00.000Z';
  let currentInvoice: FixtureInvoice | null = null;
  let checkoutStatusIndex = 0;
  const executiveRequest = {
    id: 'b070e908-b525-4fb9-9aa4-3b289d5d190b',
    task: '',
    timeline: '',
    status: options.billing?.executiveStatus ?? 'waitlisted',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };
  let storedExecutiveRequest: typeof executiveRequest | null = null;
  let receiptRows: FixtureReceipt[] =
    billingCurrentPlan === 'free'
      ? []
      : [
          {
            invoiceId: 41,
            planId: billingCurrentPlan,
            amountKopecks:
              billingCurrentPlan === 'basic'
                ? 399000
                : billingCurrentPlan === 'pro'
                  ? 990000
                  : 3990000,
            currency: 'RUB' as const,
            paidAt: '2026-10-10T10:00:00.000Z',
            paymentMethod: null,
            receiptUrl: null,
            receiptStatus: 'not-provided',
            fiscalDocumentNumber: null,
            fiscalDate: null,
          },
        ];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: { ...candidate, emailVerified: true } } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
    }
    if (path === '/api/v1/candidate/billing' && route.request().method() === 'GET') {
      const currentPlan =
        currentInvoice?.status === 'paid' ? currentInvoice.planId : billingCurrentPlan;
      const subscription =
        currentPlan === 'free'
          ? null
          : {
              status: 'active',
              currentPeriodEndsAt: billingPeriodEnd,
              nextChargeAt: billingAutoRenew ? billingPeriodEnd : null,
              autoRenew: billingAutoRenew,
            };
      return route.fulfill({
        json: {
          data: {
            currentPlan,
            subscription,
            plans: [
              {
                id: 'basic',
                name: 'Basic',
                amountKopecks: 399000,
                currency: 'RUB',
                interval: 'month',
              },
              { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
              {
                id: 'max',
                name: 'Max',
                amountKopecks: 3990000,
                currency: 'RUB',
                interval: 'month',
              },
            ],
          },
        },
      });
    }
    if (path === '/api/v1/candidate/billing/checkouts' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        planId?: FixturePaidPlan;
        autoRenew?: boolean;
      };
      const amounts: Record<FixturePaidPlan, number> = { basic: 399000, pro: 990000, max: 3990000 };
      const key = route.request().headers()['idempotency-key'] ?? 'fixture-idempotency-key';
      if (!body.planId || !(body.planId in amounts)) {
        return route.fulfill({
          status: 400,
          json: { error: { code: 'billing_checkout_invalid' } },
        });
      }
      if (!currentInvoice || currentInvoice.idempotencyKey !== key) {
        currentInvoice = {
          invoiceId: 731,
          planId: body.planId,
          amountKopecks: amounts[body.planId],
          currency: 'RUB',
          status: 'pending',
          autoRenew: body.autoRenew === true,
          paymentUrl: 'https://auth.robokassa.ru/Merchant/Index?InvoiceID=731',
          createdAt: '2026-10-11T12:00:00.000Z',
          idempotencyKey: key,
        };
      }
      return route.fulfill({
        status: 201,
        headers: { location: '/api/v1/candidate/billing/checkouts/731' },
        json: { data: checkoutResponse(currentInvoice) },
      });
    }
    if (path === '/api/v1/candidate/billing/checkouts/731' && route.request().method() === 'GET') {
      if (!currentInvoice)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'billing_checkout_not_found' } },
        });
      const statuses = options.billing?.checkoutStatuses ?? ['pending'];
      const status = statuses[Math.min(checkoutStatusIndex, statuses.length - 1)] ?? 'pending';
      checkoutStatusIndex += 1;
      currentInvoice = { ...currentInvoice, status };
      if (status === 'paid') {
        billingCurrentPlan = currentInvoice.planId;
        billingAutoRenew = currentInvoice.autoRenew;
        billingPeriodEnd = '2026-11-11T00:00:00.000Z';
        if (!receiptRows.some((receipt) => receipt.invoiceId === currentInvoice?.invoiceId)) {
          receiptRows = [
            ...receiptRows,
            {
              invoiceId: currentInvoice.invoiceId,
              planId: currentInvoice.planId,
              amountKopecks: currentInvoice.amountKopecks,
              currency: 'RUB',
              paidAt: '2026-10-11T12:05:00.000Z',
              paymentMethod: null,
              receiptUrl: null,
              receiptStatus: 'not-provided',
              fiscalDocumentNumber: null,
              fiscalDate: null,
            },
          ];
        }
      }
      return route.fulfill({ json: { data: checkoutResponse(currentInvoice) } });
    }
    if (path === '/api/v1/candidate/billing/receipts' && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: receiptRows,
          meta: { nextCursor: null },
        },
      });
    }
    if (
      path === '/api/v1/candidate/billing/subscription/cancel-renewal' &&
      route.request().method() === 'POST'
    ) {
      billingAutoRenew = false;
      return route.fulfill({
        json: {
          data: {
            planId: billingCurrentPlan === 'free' ? 'basic' : billingCurrentPlan,
            status: 'active',
            currentPeriodEndsAt: billingPeriodEnd,
            nextChargeAt: null,
            autoRenew: false,
            cancellationEventId: 'fixture-cancellation-event',
          },
        },
      });
    }
    if (path === '/api/v1/candidate/executive-requests' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { task?: string; timeline?: string };
      const replayed = storedExecutiveRequest !== null;
      storedExecutiveRequest = {
        ...executiveRequest,
        task: body.task ?? '',
        timeline: body.timeline ?? '',
      };
      return route.fulfill({
        status: replayed ? 200 : 201,
        json: { data: storedExecutiveRequest, meta: { requestId: 'fixture-request' } },
      });
    }
    if (path === '/api/v1/candidate/executive-requests' && route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          data: { items: storedExecutiveRequest ? [storedExecutiveRequest] : [], nextCursor: null },
        },
      });
    }
    if (path.endsWith('/candidate/today')) {
      const existingMomentum =
        'momentum' in todaySnapshot
          ? (todaySnapshot as { momentum?: unknown }).momentum
          : undefined;
      const snapshotWithMomentum = {
        ...todaySnapshot,
        momentum: existingMomentum ?? {
          calculatedAt: '2026-10-09T12:00:00.000Z',
          windows: {
            '7d': { applied: 4, views: 'unknown', screenings: 'unknown', interviews: 1 },
            '30d': { applied: 14, views: 'unknown', screenings: 'unknown', interviews: 2 },
          },
          burnoutNotice: false,
        },
      };
      return route.fulfill({ json: { data: snapshotWithMomentum } });
    }
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/applications') || path.endsWith('/candidate/drafts')) {
      return route.fulfill({ json: { data: [] } });
    }
    // B370: панель отправки откликов читает лимиты и квитанции; в фикстуре действий нет.
    if (path.endsWith('/candidate/actions/usage')) {
      return route.fulfill({
        json: {
          data: {
            usage: {
              localDate: '2026-10-01',
              hhAppliesCount: 0,
              linkedinEasyAppliesCount: 0,
              hhBoostsCount: 0,
              lastHhBoostAt: null,
            },
            timezone: 'Europe/Moscow',
            resetAt: '2026-10-01T21:00:00.000Z',
            killSwitchActive: false,
            limits: {
              maxHhAppliesPerDay: 15,
              maxLinkedinEasyAppliesPerDay: 10,
              maxHhBoostsPerDay: 3,
              minHhBoostIntervalMinutes: 240,
            },
          },
        },
      });
    }
    if (path.endsWith('/me/consents/actions_on_behalf')) {
      return route.fulfill({
        json: { data: { capability: 'actions_on_behalf', granted: false, consent: null } },
      });
    }
    if (path.endsWith('/candidate/actions/receipts')) {
      return route.fulfill({ json: { data: { receipts: [] } } });
    }
    // C64: шапка Профиля читает согласие «Вы в поиске»; в фикстуре оно не дано.
    if (path.endsWith('/candidate/search-consent')) {
      return route.fulfill({
        json: { data: { consent: { granted: false, policyVersion: '', updatedAt: '' } } },
      });
    }
    if (path.endsWith('/candidate/decision-profile')) {
      if (route.request().method() === 'PUT') {
        decisionProfile = {
          ...route.request().postDataJSON(),
          updatedAt: '2026-10-06T12:00:00.000Z',
        };
      }
      return route.fulfill({ json: { data: decisionProfile } });
    }
    if (path.endsWith('/candidate/skill-quiz/apply') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      skillQuizCommandId = route.request().headers()['idempotency-key'] ?? 'skill-quiz-command';
      skillQuizReverted = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const skillName = String(body.skillName ?? 'TypeScript');
      return route.fulfill({
        status: 201,
        json: {
          data: {
            commandId: skillQuizCommandId,
            command: { commandId: skillQuizCommandId },
            result: { quizId: body.quizId, statusLabel: 'подтверждён' },
            fact: {
              skillName,
              status: 'подтверждён',
              source: 'hh.ru',
              date: '2026-10-06',
              scorePercent: 100,
              statement: `${skillName}: подтверждён (hh.ru, 2026-10-06, 100%)`,
            },
          },
        },
      });
    }
    const skillQuizRevert = path.match(/\/candidate\/career-commands\/([^/]+)\/revert$/u);
    if (skillQuizRevert && route.request().method() === 'POST') {
      const commandId = decodeURIComponent(skillQuizRevert[1]!);
      if (commandId !== skillQuizCommandId) {
        return route.fulfill({
          status: 404,
          json: { error: { code: 'career_command_not_found', message: 'Команда не найдена.' } },
        });
      }
      if (skillQuizReverted) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'profile_revision_already_reverted',
              message: 'Это изменение уже отменено',
            },
          },
        });
      }
      skillQuizReverted = true;
      return route.fulfill({ json: { data: { commandId, profileRevisionReverted: true } } });
    }
    if (path.endsWith('/candidate/footprint/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: [],
            sourceAvailability: {
              sherlock: true,
              maigret: true,
              hibp: false,
              wayback: true,
              exa: false,
            },
            consent: {
              approved: false,
              granted: false,
              versionId: 'digital_footprint-v1.1',
            },
            audit: null,
          },
        },
      });
    }
    if (path.endsWith('/candidate/footprint')) {
      return route.fulfill({ json: { data: { audit: null } } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    if (path.endsWith('/account/sessions') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { revoked: 2 } } });
    }
    if (path.endsWith('/candidate/export')) {
      return route.fulfill({ json: { data: { profile: account.profile } } });
    }
    if (path.endsWith('/candidate/me') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (path.endsWith('/candidate/consultant-history')) {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const historyConversation = path.match(
      /\/candidate\/consultant-history\/([^/]+)(?:\/messages)?$/u,
    );
    if (historyConversation) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conversation_read_only',
              message: 'Продолжить беседу из истории нельзя.',
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            id: decodeURIComponent(historyConversation[1]!),
            stage: 'profile',
            openedAt: '2026-10-01T10:00:00.000Z',
            lastMessageAt: '2026-10-01T10:05:00.000Z',
            closedAt: '2026-10-01T10:06:00.000Z',
            messageCount: 2,
            firstPhrase: 'Расскажите о вашем опыте.',
            summary: null,
            messages: [],
          },
        },
      });
    }
    if (path.endsWith('/account')) {
      return route.fulfill({ json: { data: account } });
    }
    if (
      path.endsWith('/candidate/me/memory') ||
      path.endsWith('/candidate/me/turns') ||
      path.endsWith('/candidate/me/messages')
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path.endsWith('/candidate/role-hypotheses')) {
      return route.fulfill({ json: { data: roleHypotheses } });
    }
    if (path.endsWith('/candidate/resume')) {
      // B248, owner review 2026-09-23 — this shape used to disagree with
      // `ResumeStudioProjection`/`ResumeEvidenceFreshness`
      // (`server/domain/resumeStudioTypes.ts`): `evidenceFreshness.stale`
      // is an array the surface calls `.length` on, not a boolean, and it
      // crashed into the error boundary the moment «Профиль» started
      // opening this screen instead of a copy of «Сегодня». The client
      // rebuilds its own projection from the draft and never reads this
      // one, but the shape still has to be honest.
      const emptyDocument = {
        kind: 'master',
        targetRole: null,
        contact: { fullName: null, email: null, phone: null, location: null, links: [] },
        experience: [],
        education: [],
        languages: [],
        unknowns: [],
        conventions: {
          country: null,
          packVersion: null,
          reverseChronological: true,
          maxPages: null,
          recommendedBulletsPerRole: null,
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
        length: { lines: 0, pages: 1, linesPerPage: 45 },
      };
      return route.fulfill({
        json: {
          data: {
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
            },
            projection: {
              master: emptyDocument,
              germanyVariant: { ...emptyDocument, kind: 'country-role' },
              evidenceSnapshot: [],
              excludedEvidenceIds: [],
            },
            evidenceFreshness: { valid: true, stale: [] },
          },
        },
      });
    }
    if (path.endsWith('/candidate/matched-vacancies')) {
      return route.fulfill({
        json: matchedVacancyPage(Number(url.searchParams.get('offset') ?? 0)),
      });
    }
    if (
      path.endsWith('/candidate/vacancy-subscriptions') ||
      path.endsWith('/candidate/vacancy-sources') ||
      path.endsWith('/candidate/vacancy-applications') ||
      path.endsWith('/candidate/connections') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
    }
    if (
      path.endsWith('/candidate/strategy') ||
      path.endsWith('/candidate/work-preferences') ||
      path.endsWith('/candidate/reputation-audit') ||
      path.endsWith('/candidate/desktop-tunnel')
    ) {
      return route.fulfill({ json: { data: null } });
    }
    unmatched.push(path);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await mockCandidateCompanies(page);
  return unmatched;
}

function checkoutResponse(invoice: FixtureInvoice) {
  return {
    invoiceId: invoice.invoiceId,
    planId: invoice.planId,
    amountKopecks: invoice.amountKopecks,
    currency: invoice.currency,
    status: invoice.status,
    autoRenew: invoice.autoRenew,
    paymentUrl: invoice.paymentUrl,
    createdAt: invoice.createdAt,
  };
}
