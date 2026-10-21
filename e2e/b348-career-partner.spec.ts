import { expect, test, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const PARTNER = {
  username: 'partner.test',
  email: 'partner@example.test',
  displayName: 'Анна Петрова',
  role: 'CareerPartner' as const,
  isTest: true,
  candidateId: null,
  emailVerified: true,
};

const ADMIN = {
  username: 'admin.test',
  email: 'admin@example.test',
  displayName: 'Администратор',
  role: 'admin' as const,
  isTest: true,
  candidateId: null,
  emailVerified: true,
};

const PARTNER_USER = {
  id: 'partner-user-1',
  username: PARTNER.username,
  role: 'CareerPartner',
  isTest: true,
  email: PARTNER.email,
  displayName: PARTNER.displayName,
  headline: null,
  location: null,
  workMode: null,
  candidateId: null,
  blockedAt: null,
  subscriptionTier: 'free',
  subscriptionStatus: 'active',
  subscriptionExpiresAt: null,
  subscriptionNotes: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  activeSessions: 1,
  lastSeenAt: '2026-10-20T10:00:00.000Z',
};

const CANDIDATE_USER = {
  id: 'candidate-user-1',
  username: 'maria',
  role: 'candidate',
  isTest: true,
  email: 'maria@example.test',
  displayName: 'Мария Иванова',
  headline: 'Product Lead',
  location: 'Москва',
  workMode: 'remote',
  candidateId: 'candidate-1',
  blockedAt: null,
  subscriptionTier: 'free',
  subscriptionStatus: 'active',
  subscriptionExpiresAt: null,
  subscriptionNotes: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  activeSessions: 1,
  lastSeenAt: '2026-10-20T10:00:00.000Z',
};

function data(value: unknown) {
  return { data: value, meta: { requestId: 'b348-e2e' } };
}

async function fulfill(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, json: data(value) });
  return true;
}

function emptyFunnel() {
  return {
    saved: 0,
    applied: 1,
    responded: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    archived: 0,
    opened: 1,
  };
}

function writeEvidenceDir() {
  const directory = join(process.cwd(), 'test-results', 'evidence', 'B348');
  mkdirSync(directory, { recursive: true });
  return directory;
}

test('career partner sees assigned candidate data and saves a campaign', async ({
  page,
}, testInfo) => {
  let campaignSaveCount = 0;
  let savedCampaignBody: unknown;
  await mockSignedInCabinet(page, {
    initialSession: PARTNER,
    adminRouteHandler: async (route, path) => {
      if (path === '/api/v1/admin/partner/candidates') {
        return fulfill(route, {
          total: 1,
          items: [
            {
              userId: 'candidate-user-1',
              displayName: 'Мария Иванова',
              headline: 'Product Lead',
              location: 'Москва',
            },
          ],
          nextOffset: null,
          permissions: {
            can_view_candidates: true,
            can_edit_campaigns: true,
            can_manage_pool: false,
            can_view_audit: false,
          },
        });
      }
      if (path === '/api/v1/admin/partner/candidates/candidate-user-1/campaign') {
        const campaign = {
          roles: { value: ['Product Lead'], origin: 'candidate' },
          regions: { value: ['ru'], origin: 'candidate' },
          remoteOnly: false,
        };
        if (route.request().method() === 'PATCH') {
          campaignSaveCount += 1;
          savedCampaignBody = route.request().postDataJSON();
          return fulfill(route, campaign);
        }
        return fulfill(route, campaign);
      }
      if (path === '/api/v1/admin/partner/candidates/candidate-user-1') {
        return fulfill(route, {
          candidate: {
            userId: 'candidate-user-1',
            displayName: 'Мария Иванова',
            headline: 'Product Lead',
            location: 'Москва',
          },
          resume: {
            draft: {
              candidate: { about: 'Продуктовый руководитель в финтехе.' },
              targetRole: 'Product Lead',
              experience: [
                {
                  id: 'exp-1',
                  title: 'Product Lead',
                  employer: 'FinCloud',
                  current: true,
                  chronologyMemoryId: 'mem-1',
                  bulletMemoryIds: [],
                },
              ],
              skills: [{ name: 'Product discovery' }],
              education: [],
              languages: [],
            },
          },
          applications: { total: 1, funnel: emptyFunnel() },
        });
      }
      return false;
    },
  });

  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Закреплённые кандидаты' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мария Иванова' })).toBeVisible();
  await expect(page.getByText('Продуктовый руководитель в финтехе.')).toBeVisible();
  await expect(page.getByText('Всего записей: 1')).toBeVisible();
  await page.getByLabel('Целевые роли').fill('Product Lead\nHead of Product');
  await page.getByRole('button', { name: 'Сохранить кампанию' }).click();
  await expect(page.getByRole('status')).toContainText('Кампания сохранена.');
  expect(campaignSaveCount).toBe(1);
  expect(savedCampaignBody).toMatchObject({ roles: ['Product Lead', 'Head of Product'] });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: join(writeEvidenceDir(), `partner-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test('administrator changes partner permission and assignment', async ({ page }, testInfo) => {
  let assigned = false;
  let permissionEnabled = false;
  await mockSignedInCabinet(page, {
    initialSession: ADMIN,
    adminRouteHandler: async (route, path) => {
      const method = route.request().method();
      if (path === '/api/v1/admin/users') {
        const query = new URL(route.request().url()).searchParams;
        const users =
          query.get('role') === 'candidate' ? [CANDIDATE_USER] : [PARTNER_USER, CANDIDATE_USER];
        return fulfill(route, { total: users.length, users });
      }
      if (path === '/api/v1/admin/users/partner-user-1/permissions') {
        if (method === 'PATCH')
          permissionEnabled = Boolean(
            (route.request().postDataJSON() as { enabled?: boolean }).enabled,
          );
        return fulfill(route, {
          role: 'CareerPartner',
          overrides: permissionEnabled ? { can_edit_campaigns: true } : {},
          permissions: {
            can_view_candidates: true,
            can_edit_campaigns: permissionEnabled,
            can_manage_pool: false,
            can_view_audit: false,
          },
        });
      }
      if (path === '/api/v1/admin/users/partner-user-1/partner-assignments' && method === 'POST') {
        assigned = true;
        return fulfill(route, { assigned: true }, 201);
      }
      if (
        path === '/api/v1/admin/users/partner-user-1/partner-assignments/candidate-user-1' &&
        method === 'DELETE'
      ) {
        assigned = false;
        return fulfill(route, { assigned: false });
      }
      if (path === '/api/v1/admin/users/partner-user-1/partner-assignments') {
        return fulfill(route, {
          total: assigned ? 1 : 0,
          items: assigned
            ? [
                {
                  userId: 'candidate-user-1',
                  displayName: 'Мария Иванова',
                  headline: 'Product Lead',
                  location: 'Москва',
                },
              ]
            : [],
          nextOffset: null,
        });
      }
      return false;
    },
  });

  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Управление аккаунтом partner.test' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /partner\.test/ })).toBeVisible();
  const campaignPermission = dialog.getByLabel('Редактирование кампаний');
  await campaignPermission.check();
  await expect(campaignPermission).toBeChecked();
  await page.getByLabel('Найти кандидата').fill('Мария');
  await dialog.getByRole('button', { name: 'Найти' }).click();
  await expect(dialog.getByText('Мария Иванова', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрепить' }).click();
  await expect(dialog.getByText('Мария Иванова · Product Lead')).toBeVisible();
  expect(assigned).toBe(true);
  expect(permissionEnabled).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: join(writeEvidenceDir(), `admin-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
