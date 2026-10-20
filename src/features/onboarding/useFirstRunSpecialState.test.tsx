// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyLinkedInImportProgress } from '../connections/linkedinImportProgress';
import type { FirstRunSpecialView } from './useFirstRunSpecialState';

const getConnections = vi.fn();
vi.mock('../coach/coachApi', () => ({ getConnections: () => getConnections() }));

const { useFirstRunSpecialState } = await import('./useFirstRunSpecialState');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

function mountHook(candidateId: string | null): { current: FirstRunSpecialView | null } {
  const view: { current: FirstRunSpecialView | null } = { current: null };
  function Probe() {
    view.current = useFirstRunSpecialState(candidateId);
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root?.render(<Probe />));
  return view;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  getConnections.mockReset();
  applyLinkedInImportProgress({ type: 'end' });
});

describe('useFirstRunSpecialState', () => {
  it('reads connectors from the server and notes one connected source', async () => {
    getConnections.mockResolvedValue([
      { platform: 'linkedin', status: 'connected' },
      { platform: 'hh', status: 'disconnected' },
    ]);
    const view = mountHook('cand-1');
    await flush();
    expect(view.current?.partialMessage).toBe(
      'LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.',
    );
  });

  it('says nothing about connectors when the server does not answer', async () => {
    getConnections.mockRejectedValue(new Error('network'));
    const view = mountHook('cand-1');
    await flush();
    expect(getConnections).toHaveBeenCalledTimes(1);
    expect(view.current?.partialMessage).toBeNull();
  });

  it('does not ask the server without a candidate', () => {
    const view = mountHook(null);
    expect(getConnections).not.toHaveBeenCalled();
    expect(view.current?.partialMessage).toBeNull();
  });

  it('labels a LinkedIn walk only after it runs longer than usual', () => {
    vi.useFakeTimers();
    const view = mountHook(null);
    act(() => {
      applyLinkedInImportProgress({ type: 'start', keys: ['experience', 'education', 'skills'] });
      applyLinkedInImportProgress({ type: 'read', key: 'experience' });
    });
    expect(view.current?.importLabel).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(view.current?.importLabel).toBe('Читаем LinkedIn: раздел 2 из 3');
    act(() => applyLinkedInImportProgress({ type: 'end' }));
    expect(view.current?.importLabel).toBeNull();
  });
});
