import type { Route } from '@playwright/test';

const BASE = '/api/v1/candidate/notifications';
const PREFERENCES = [
  { key: 'ev-reply', app: true, email: true },
  { key: 'ev-reminder', app: true, email: false },
  { key: 'ev-approval', app: true, email: false },
  { key: 'ev-delivery-error', app: true, email: true },
  { key: 'ev-target-company', app: true, email: false },
  { key: 'ev-weekly-digest', app: true, email: true },
];

export async function mockNotificationRequest(route: Route, path: string): Promise<boolean> {
  if (!path.startsWith(BASE)) return false;
  const method = route.request().method();
  if (path === `${BASE}/preferences` && method === 'GET') {
    await route.fulfill({ json: { data: { events: PREFERENCES } } });
    return true;
  }
  if (path.startsWith(`${BASE}/preferences/`) && method === 'PUT') {
    await route.fulfill({
      json: { data: { ...route.request().postDataJSON(), updatedAt: '2026-10-11T12:00:00.000Z' } },
    });
    return true;
  }
  if (path === BASE && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], unreadCount: 0, nextCursor: null } } });
    return true;
  }
  if (path === `${BASE}/read-all` && method === 'PUT') {
    await route.fulfill({ json: { data: { updated: 0 } } });
    return true;
  }
  const match = path.match(/^\/api\/v1\/candidate\/notifications\/([0-9a-f-]{36})\/read$/u);
  if (match && method === 'PUT') {
    await route.fulfill({ json: { data: { id: match[1], readAt: '2026-10-11T12:00:00.000Z' } } });
    return true;
  }
  await route.fulfill({ status: 404, json: { error: { code: 'notification_not_found' } } });
  return true;
}
