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

export async function mockSignedInCabinet(page: Page): Promise<string[]> {
  const unmatched: string[] = [];
  const applicationLabels: Array<{ id: string; name: string; createdAt: string }> = [];
  const companyWants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }> = [];
  const applicationOperationResults = new Map<
    string,
    { fingerprint: string; result: Record<string, unknown> }
  >();
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: { ...candidate, emailVerified: true } } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
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
    if (path.endsWith('/candidate/application-labels')) {
      if (route.request().method() === 'POST') {
        const name = String(route.request().postDataJSON().name ?? '')
          .trim()
          .replace(/\s+/gu, ' ');
        const existing = applicationLabels.find(
          (label) => label.name.toLocaleLowerCase('und') === name.toLocaleLowerCase('und'),
        );
        const label = existing ?? {
          id: `mock-label-${applicationLabels.length + 1}`,
          name,
          createdAt: new Date().toISOString(),
        };
        if (!existing) applicationLabels.push(label);
        return route.fulfill({ status: existing ? 200 : 201, json: { data: label } });
      }
      return route.fulfill({ json: { data: applicationLabels } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk/preview')) {
      const body = route.request().postDataJSON();
      const wanted = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<{ companyName: string }>)
        : [];
      const affectedCount = companies.filter((company) =>
        body.action === 'add'
          ? !wanted.has(company.companyName.toLocaleLowerCase('und'))
          : wanted.has(company.companyName.toLocaleLowerCase('und')),
      ).length;
      return route.fulfill({ json: { data: { affectedCount } } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk')) {
      const body = route.request().postDataJSON();
      const replay = applicationOperationResults.get(String(body.operationId));
      const fingerprint = JSON.stringify({
        action: body.action,
        companies: body.companies,
        confirmCount: body.confirmCount,
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<Record<string, unknown>>)
        : [];
      const keys = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const targets = companies.filter((company) => {
        const exists = keys.has(String(company.companyName).toLocaleLowerCase('und'));
        return body.action === 'add' ? !exists : exists;
      });
      if (Number(body.confirmCount) !== targets.length) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'bulk_confirmation_count_changed',
              details: { affectedCount: targets.length },
            },
          },
        });
      }
      for (const company of targets)
        applyMockCompanyWant(companyWants, company, String(body.action));
      const result = { state: 'completed', changedCount: targets.length };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (path.endsWith('/candidate/applications/company-wants')) {
      return route.fulfill({ json: { data: companyWants } });
    }
    if (path.endsWith('/candidate/applications/bulk/preview')) {
      return route.fulfill({ json: { data: { affectedCount: 0 } } });
    }
    if (path.endsWith('/candidate/applications/bulk')) {
      const body = route.request().postDataJSON();
      const fingerprint = JSON.stringify({
        filters: body.filters,
        action: body.action,
        confirmCount: body.confirmCount,
      });
      const replay = applicationOperationResults.get(String(body.operationId));
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      if (Number(body.confirmCount) !== 0) {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: 'bulk_confirmation_count_changed', details: { affectedCount: 0 } },
          },
        });
      }
      const result =
        body.action?.type === 'retry'
          ? { state: 'prepared', preparedCount: 0, sentCount: 0, changedCount: 0 }
          : { state: 'completed', changedCount: 0 };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (/\/candidate\/applications\/[^/]+\/labels\/[^/]+$/u.test(path)) {
      return route.fulfill({ status: 404, json: { error: { code: 'application_not_found' } } });
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

function applyMockCompanyWant(
  wants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }>,
  company: Record<string, unknown>,
  action: string,
): void {
  const companyName = String(company.companyName ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  const normalized = companyName.normalize('NFKC').toLocaleLowerCase('und');
  const index = wants.findIndex(
    (want) => want.companyName.normalize('NFKC').toLocaleLowerCase('und') === normalized,
  );
  if (action === 'add' && index < 0) {
    wants.push({
      companyKey: `mock:${normalized}`,
      companyName,
      nextStep: null,
      nextStepDueAt: null,
      updatedAt: new Date().toISOString(),
    });
  }
  if (action === 'set_next_step' && index >= 0) {
    wants[index]!.nextStep = String(company.nextStep ?? '');
    wants[index]!.nextStepDueAt = company.nextStepDueAt ? String(company.nextStepDueAt) : null;
    wants[index]!.updatedAt = new Date().toISOString();
  }
  if (action === 'remove' && index >= 0) wants.splice(index, 1);
}
