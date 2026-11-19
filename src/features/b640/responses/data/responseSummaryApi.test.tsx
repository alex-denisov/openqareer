// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), readDataObject: vi.fn() }));
vi.mock('../../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../../coach/apiClient')>()),
  apiFetch: api.apiFetch,
  readDataObject: api.readDataObject,
}));

import { useAutoApplicationIds } from './responseSummaryApi';

let root: Root | null = null;
let seen: ReadonlySet<string> | null = null;

function Probe() {
  seen = useAutoApplicationIds();
  return null;
}

async function mount() {
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.clearAllMocks();
});

describe('B680: автоотклики для списка и воронки', () => {
  it('берёт id автооткликов из сводки сервера', async () => {
    api.apiFetch.mockResolvedValue(new Response('{}'));
    api.readDataObject.mockResolvedValue({ counts: {}, autoApplicationIds: ['a1', 'a2'] });
    await mount();
    expect(api.apiFetch).toHaveBeenCalledWith('/api/v1/candidate/b640/responses/summary', expect.anything());
    expect([...seen!]).toEqual(['a1', 'a2']);
  });

  it('без сводки список не ломается: автооткликов просто нет', async () => {
    api.apiFetch.mockRejectedValue(new Error('404'));
    await mount();
    expect(seen!.size).toBe(0);
  });
});
