// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useRelocationConsent } from './useRelocationConsent';

const getRelocationQuestionnaire = vi.hoisted(() => vi.fn());
vi.mock('../relocation/relocationApi', () => ({ getRelocationQuestionnaire }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const granted = useRelocationConsent(true, 0);
  return <span data-testid="value">{String(granted)}</span>;
}

async function readProbe(): Promise<string> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  const value = host.textContent ?? '';
  act(() => root.unmount());
  return value;
}

describe('статус релокации на «Карьере» из анкеты (B445-r1)', () => {
  it('после согласия в анкете строка показывает «включено»', async () => {
    getRelocationQuestionnaire.mockResolvedValueOnce({ consent: { granted: true } });
    expect(await readProbe()).toBe('true');
  });

  it('без согласия — выключено, без ответа — неизвестно', async () => {
    getRelocationQuestionnaire.mockResolvedValueOnce({ consent: { granted: false } });
    expect(await readProbe()).toBe('false');
    getRelocationQuestionnaire.mockRejectedValueOnce(new Error('offline'));
    expect(await readProbe()).toBe('null');
  });
});
