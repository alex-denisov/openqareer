// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsesPipelineAnalytics } from './ResponsesPipelineAnalytics';
import { listApplicationsPool } from './applicationsApi';
import type { ApplicationView } from './applicationsApi';
vi.mock('./applicationsApi', () => ({ listApplicationsPool: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const revision: readonly ApplicationView[] = [];
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); vi.clearAllMocks(); });
async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<ResponsesPipelineAnalytics query={{ stage: ['applied'], from: '2026-10-01', channel: ['hh'] }} revision={revision} onOpenVacancies={() => {}} />));
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((entry) => entry.textContent === text)!;
  await act(async () => button.click());
  return button;
}
function emptyPage() {
  return { items: [], meta: { total: 0, limit: 100, offset: 0, stageCounts: {}, source: 'server' } };
}
describe('B355 real analytics disclosure', () => {
  it('loads a complete cohort only after real toggle and exposes expanded state', async () => {
    vi.mocked(listApplicationsPool).mockResolvedValue(emptyPage() as Awaited<ReturnType<typeof listApplicationsPool>>);
    await mount();
    expect(listApplicationsPool).not.toHaveBeenCalled();
    const toggle = await click('Аналитика этапов');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(listApplicationsPool).toHaveBeenCalledWith({ from: '2026-10-01', to: undefined, channel: ['hh'] }, expect.any(AbortSignal));
    expect(host.textContent).toContain('Пока нет данных для аналитики');
    await click('Аналитика этапов');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('div[hidden]')).not.toBeNull();
  });
  it('does not display partial-page metrics and retries a failed full cohort load', async () => {
    vi.mocked(listApplicationsPool).mockResolvedValueOnce({ ...emptyPage(), meta: { ...emptyPage().meta, total: 5 } } as Awaited<ReturnType<typeof listApplicationsPool>>).mockResolvedValueOnce(emptyPage() as Awaited<ReturnType<typeof listApplicationsPool>>);
    await mount(); await click('Аналитика этапов');
    expect(host.textContent).toContain('Конверсии не рассчитаны');
    expect(host.textContent).not.toContain('Сквозная конверсия');
    await click('Повторить загрузку аналитики');
    expect(host.textContent).toContain('Пока нет данных для аналитики');
    expect(listApplicationsPool).toHaveBeenCalledTimes(2);
  });
});
