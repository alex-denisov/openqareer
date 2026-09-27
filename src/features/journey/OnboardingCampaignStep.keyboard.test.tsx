// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OnboardingCampaignStep } from './OnboardingCampaignStep';
import { ONBOARDING_FORMAT_OPTIONS, type OnboardingFormat } from './onboardingFormat';

describe('OnboardingCampaignStep format radio keyboard behavior', () => {
  let container: HTMLDivElement;
  let root: Root;

  function Probe() {
    const [format, setFormat] = useState<OnboardingFormat>(ONBOARDING_FORMAT_OPTIONS[0]);
    return (
      <OnboardingCampaignStep
        state="model"
        roles={[]}
        selectedRoleIds={[]}
        regions={[]}
        format={format}
        elapsedSeconds={null}
        onToggleRole={() => undefined}
        onAddRole={() => undefined}
        onToggleRegion={() => undefined}
        onChangeFormat={setFormat}
      />
    );
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('moves selection and focus with arrow keys and keeps one tab stop', async () => {
    await act(async () => root.render(<Probe />));
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(radios).toHaveLength(ONBOARDING_FORMAT_OPTIONS.length);
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);

    await act(async () => {
      radios[0].focus();
      radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);
  });
});
