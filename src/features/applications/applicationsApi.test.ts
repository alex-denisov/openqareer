import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_STAGES } from '../../../shared/applicationStage';
import { apiFetch } from '../coach/apiClient';
import { listApplicationsPage } from './applicationsApi';

vi.mock('../coach/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../coach/apiClient')>();
  return { ...original, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

describe('listApplicationsPage (B450)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends server filters, sorting and twenty-row offset', async () => {
    apiFetchMock.mockResolvedValue(pageResponse([{ id: 'app-21' }], { total: 41, offset: 20, limit: 20 }));

    await listApplicationsPage({
      stage: ['applied'], channel: ['LinkedIn', 'hh.ru'], from: '2026-10-01', to: '2026-10-10',
      sort: 'company', direction: 'asc', limit: 20, offset: 20,
    });

    const [url] = apiFetchMock.mock.calls[0] ?? [];
    const params = new URL(String(url), 'http://localhost').searchParams;
    expect(params.getAll('stage')).toEqual(['applied']);
    expect(params.getAll('channel')).toEqual(['LinkedIn', 'hh.ru']);
    expect(params.get('from')).toBe('2026-10-01');
    expect(params.get('to')).toBe('2026-10-10');
    expect(params.get('sort')).toBe('company');
    expect(params.get('direction')).toBe('asc');
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('20');
  });

  it('keeps server total and stage counts separate from loaded page items', async () => {
    const counts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, stage === 'applied' ? 41 : 0]));
    apiFetchMock.mockResolvedValue(pageResponse([{ id: 'app-21' }], { total: 41, offset: 20, limit: 20, stageCounts: counts }));

    const page = await listApplicationsPage({ offset: 20, limit: 20 });

    expect(page.items).toEqual([{ id: 'app-21' }]);
    expect(page.meta).toMatchObject({ total: 41, offset: 20, limit: 20, stageCounts: counts });
  });

  it('uses loaded fixture rows when an older test response has no page metadata', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'app-1' }] }), { status: 200 }));

    const page = await listApplicationsPage();

    expect(page.items).toEqual([{ id: 'app-1' }]);
    expect(page.meta.total).toBe(1);
    expect(page.meta.stageCounts.saved).toBe(0);
  });
});

function pageResponse(items: readonly { id: string }[], meta: Record<string, unknown>): Response {
  const stageCounts = meta.stageCounts ?? Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0]));
  return new Response(JSON.stringify({
    data: items,
    meta: { requestId: 'test-request', total: 1, offset: 0, limit: 20, stageCounts, ...meta },
  }), { status: 200 });
}
