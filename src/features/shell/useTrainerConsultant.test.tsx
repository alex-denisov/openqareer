// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConsultantSuggestionProvider,
  useMarkTrainerResult,
  useMarkTrainerScreen,
} from '../journey/consultantScreenSuggestion';
import { useTrainerConsultant } from './useTrainerConsultant';

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.innerHTML = '';
});

function Trainer({ open, result = false }: { readonly open: boolean; readonly result?: boolean }) {
  useMarkTrainerScreen(open);
  useMarkTrainerResult(open && result);
  return null;
}

let latest: ReturnType<typeof useTrainerConsultant> | undefined;
function Shell({ visible, compact }: { readonly visible: boolean; readonly compact: boolean }) {
  latest = useTrainerConsultant(visible, compact);
  return null;
}

async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  const render = (trainer: boolean, visible: boolean, compact = false, result = false) =>
    act(async () =>
      root.render(
        <ConsultantSuggestionProvider>
          <Trainer open={trainer} result={result} />
          <Shell visible={visible} compact={compact} />
        </ConsultantSuggestionProvider>,
      ),
    );
  return render;
}

describe('consultant column on the mock interview trainer (mockup 14)', () => {
  it('leaves the shell alone without a trainer', async () => {
    const render = await mount();
    await render(false, true);
    expect(latest).toMatchObject({ showTopbarButton: false, panelColClass: '' });
  });

  it('hides the open column behind the trainer and offers the top-bar icon', async () => {
    const render = await mount();
    await render(true, true);
    expect(latest).toMatchObject({ showTopbarButton: true, panelColClass: ' is-behind-trainer' });
  });

  it('the icon lays the consultant over the trainer until it is closed', async () => {
    const render = await mount();
    await render(true, false);
    await act(async () => latest!.request());
    await render(true, true);
    expect(latest).toMatchObject({ showTopbarButton: false, panelColClass: ' is-over-trainer' });
    await render(true, false);
    expect(latest).toMatchObject({ showTopbarButton: true, panelColClass: ' is-behind-trainer' });
  });

  it('forgets the request when the trainer closes', async () => {
    const render = await mount();
    await render(true, true);
    await act(async () => latest!.request());
    await render(false, true);
    await render(true, true);
    expect(latest?.panelColClass).toBe(' is-behind-trainer');
  });

  it('drops the top-bar icon on the result step, as mockup 14 `res` (B511 G3b item 5)', async () => {
    const render = await mount();
    await render(true, true, false, true);
    expect(latest).toMatchObject({ showTopbarButton: false, panelColClass: ' is-behind-trainer' });
    await render(true, true, false, false);
    expect(latest?.showTopbarButton).toBe(true);
  });

  it('does nothing at 390, where the trainer has its own consultant button', async () => {
    const render = await mount();
    await render(true, true, true);
    expect(latest).toMatchObject({ showTopbarButton: false, panelColClass: '' });
  });
});
