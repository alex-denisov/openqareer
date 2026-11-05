// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { LetterActions } from './VacancyLetterActions';
import { askEditsOptions } from './VacancyLetterScreen';
import type { ApprovalState } from './vacancyLetterController';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('«Попросить правки» (Д4)', () => {
  it('asks the shell to focus the consultant input', () => {
    expect(askEditsOptions).toEqual({ focusInput: true });
  });

  it('calls the handler from the button', () => {
    const onAskEdits = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const approval = { busy: false, error: '', saved: null, approve: vi.fn(), reset: vi.fn() } as unknown as ApprovalState;
    act(() => root.render(<LetterActions approval={approval} pitchReady onAskEdits={onAskEdits} />));
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('Попросить правки'));
    act(() => button?.click());
    expect(onAskEdits).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
