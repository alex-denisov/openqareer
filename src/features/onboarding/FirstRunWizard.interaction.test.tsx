// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRunWizard } from './FirstRunWizard';

vi.mock('../journey/useResumeIngestion', () => ({
  useResumeIngestion: () => ({ result: undefined, busy: false, readPdf: async () => undefined }),
}));

describe('FirstRunWizard actions', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  it('sends platform choice to real account connections and chat to the shell consultant', async () => {
    const connectSource = vi.fn();
    const openConsultant = vi.fn();
    const host = document.createElement('div');
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <FirstRunWizard onOpenConsultant={openConsultant} onConnectSource={connectSource} />,
      );
    });

    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="source-opt-hh"]')?.click());
    expect(connectSource).toHaveBeenCalledWith('hh');

    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="source-opt-talk"]')?.click());
    expect(openConsultant).toHaveBeenCalledTimes(1);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.first-run-starter-btn')?.click();
    });
    expect(openConsultant).toHaveBeenCalledWith('С чего начать?');
  });
});
