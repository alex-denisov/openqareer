// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire, type RelocationQuestionnaire as RelocationQuestionnaireData } from '../../../shared/relocationQuestionnaire';
import * as relocationApi from './relocationApi';
import { RelocationQuestionnaire } from './RelocationQuestionnaire';

describe('RelocationQuestionnaire', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.restoreAllMocks();
  });

  it('persists a skipped step and moves to the next step with the current revision', async () => {
    const profile = emptyRelocationQuestionnaire();
    const updated = {
      ...profile,
      revision: 1,
      currentStep: 'education' as const,
      skippedSteps: ['citizenship_documents' as const],
    };
    const saveProgress = vi.spyOn(relocationApi, 'putRelocationQuestionnaireProgress').mockResolvedValueOnce({
      profile: updated,
      alerts: [],
    });
    const onProfileUpdated = vi.fn();
    render(profile, onProfileUpdated);

    await clickButton('Пропустить шаг');

    expect(saveProgress).toHaveBeenCalledWith(
      { currentStep: 'education', skippedSteps: ['citizenship_documents'] },
      0,
    );
    expect(onProfileUpdated).toHaveBeenCalledWith(updated);
    expect(host?.textContent).toContain('Шаг 2 из 4');
  });

  function render(profile: RelocationQuestionnaireData, onProfileUpdated: (profile: RelocationQuestionnaireData) => void) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(
      <RelocationQuestionnaire
        profile={profile}
        initialStep="citizenship_documents"
        onClose={vi.fn()}
        onShowCountries={vi.fn()}
        onProfileUpdated={onProfileUpdated}
      />,
    ));
  }

  async function clickButton(label: string) {
    const button = [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === label);
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
  }
});
