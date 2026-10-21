import type { Page } from '@playwright/test';
import type { ProposedRole } from '../../shared/roleProposals';

/**
 * Роли «Карьеры» с решениями кандидата (B445): `role-hypotheses` отдаёт
 * `meta.roleDecisions`, `coach/proposals/reject` их пишет, `candidate/strategy`
 * хранит принятую роль. Состояние живёт в замыкании и переживает перезагрузку.
 */
export interface MockCareerRolesOptions {
  readonly roles: readonly ProposedRole[];
  readonly acceptedTitle?: string | null;
}

export async function mockCareerRoles(page: Page, options: MockCareerRolesOptions): Promise<void> {
  const keys: string[] = [];
  let acceptedTitle = options.acceptedTitle ?? null;
  const withPrefix = (prefix: string) =>
    keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  const strategy = () =>
    acceptedTitle
      ? {
          current: {
            version: 1,
            role: { title: acceptedTitle },
            constraints: {},
            reason: 'fixture',
            decidedAt: '2026-10-06T12:00:00.000Z',
            provenance: { source: 'candidate' },
          },
          history: [],
        }
      : null;

  await page.route('**/api/v1/candidate/role-hypotheses', (route) =>
    route.fulfill({
      json: {
        data: options.roles,
        meta: {
          roleDecisions: {
            rejected: withPrefix('career-role:'),
            offersDismissed: withPrefix('career-role-offer:'),
          },
        },
      },
    }),
  );
  await page.route('**/api/v1/coach/proposals/reject', (route) => {
    const { proposalKey } = route.request().postDataJSON() as { proposalKey: string };
    keys.push(proposalKey);
    return route.fulfill({ json: { data: { ok: true, proposalKey } } });
  });
  await page.route('**/api/v1/candidate/strategy', (route) => {
    if (route.request().method() === 'POST') {
      acceptedTitle = (route.request().postDataJSON() as { title: string }).title;
    }
    return route.fulfill({ json: { data: strategy() } });
  });
}
