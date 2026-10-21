// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import * as relocationApi from './relocationApi';
import { RelocationMobileQuestionnaire } from './RelocationMobileQuestionnaire';

describe('RelocationMobileQuestionnaire (mockup 15 at 390)', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    vi.restoreAllMocks();
  });

  it('shows step 1 as grouped rows in a push screen, without tabs or a stepper', () => {
    render();
    expect(heading('h1')).toBe('Анкета');
    expect(heading('h2')).toBe('Условия для переезда');
    expect(host?.textContent).toContain('Шаг 1 из 4');
    expect(host?.querySelector('[role="tablist"]')).toBeNull();
    expect(host?.querySelector('.career-relocation-stepper')).toBeNull();
    expect(host?.querySelector('[role="switch"]')).not.toBeNull();
    expect(buttonByText('Дальше')).toBeDefined();
  });

  it('adds a document on its own screen and lists it as a row', async () => {
    render();
    await click(buttonByText('Добавить документ'));
    expect(heading('h1')).toBe('Документ');
    expect(buttonByText('Сохранить')?.disabled).toBe(true);

    await click(host?.querySelector<HTMLButtonElement>('#relocation-new-document-country'));
    await click(
      [...(host?.querySelectorAll<HTMLButtonElement>('[role="option"] button') ?? [])].find(
        (item) => item.textContent === 'Сербия',
      ),
    );
    await click(buttonByText('Сохранить'));

    expect(heading('h1')).toBe('Анкета');
    expect(host?.textContent).toContain('ВНЖ, Сербия');
  });

  it('saves step 1 and moves to step 2', async () => {
    const profile = emptyRelocationQuestionnaire();
    vi.spyOn(relocationApi, 'putRelocationQuestionnaireStep').mockResolvedValueOnce({
      profile: { ...profile, revision: 1 },
      alerts: [],
    });
    vi.spyOn(relocationApi, 'putRelocationQuestionnaireProgress').mockResolvedValueOnce({
      profile: { ...profile, revision: 2, currentStep: 'education' },
      alerts: [],
    });
    render();
    await click(buttonByText('Дальше'));
    expect(host?.textContent).toContain('Шаг 2 из 4');
    expect(host?.textContent).toContain('Добавить образование');
  });

  function render() {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <RelocationMobileQuestionnaire
          profile={emptyRelocationQuestionnaire()}
          initialStep="citizenship_documents"
          onClose={vi.fn()}
          onShowCountries={vi.fn()}
          onProfileUpdated={vi.fn()}
        />,
      ),
    );
  }

  function heading(tag: 'h1' | 'h2') {
    return host?.querySelector(tag)?.textContent;
  }

  function buttonByText(label: string) {
    return [...(host?.querySelectorAll('button') ?? [])].find((item) =>
      item.textContent?.includes(label),
    );
  }

  async function click(button: HTMLButtonElement | null | undefined) {
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
  }
});
