// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminBulkLlmSpend } from './AdminBulkLlmSpend';
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function mount() {
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () => root!.render(<AdminBulkLlmSpend />));
  return div;
}
it('read-only admin section fetches actual limits, holds and budget stop event', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'}:${url}`);
      return Response.json({
        data: {
          enabled: true,
          spentUsd: 0.2,
          heldUsd: 0.1,
          remainingUsd: 0.7,
          dayRemainingUsd: 0.4,
          limits: { runUsd: 0.5, dayUsd: 1, totalUsd: 1, perRequestUsd: 0.1 },
          events: [{ kind: 'budget_exceeded', created_at: '2026-10-18T12:00:00Z' }],
        },
      });
    }),
  );
  const div = await mount();
  expect(div.textContent).toContain('Зарезервировано');
  expect(div.textContent).toContain('Достигнут лимит');
  await act(async () => div.querySelector('button')!.click());
  expect(calls).toHaveLength(2);
  expect(
    calls.every((call) => call.startsWith('GET:') && call.endsWith('/api/admin/llm-spend')),
  ).toBe(true);
});
it('unavailable spend reports error instead of invented zero remaining', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: { message: 'unavailable' } }, { status: 503 })),
  );
  const div = await mount();
  expect(div.querySelector('[role="alert"]')).not.toBeNull();
  expect(div.textContent).not.toContain('Общий остаток');
});
