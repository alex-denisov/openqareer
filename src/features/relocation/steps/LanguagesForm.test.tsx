// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyRelocationQuestionnaire,
  type RelocationQuestionnaire,
} from '../../../../shared/relocationQuestionnaire';
import { LanguagesForm } from './LanguagesForm';

describe('LanguagesForm (mockup 15 view=i4): the language comes from a list', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('offers languages as a select and adds the chosen one', async () => {
    const onProfileChange = vi.fn<(profile: RelocationQuestionnaire) => void>();
    render(onProfileChange);
    const select = host?.querySelector<HTMLSelectElement>('#relocation-new-language-name');
    expect(select?.tagName).toBe('SELECT');
    expect([...(select?.options ?? [])].map((option) => option.textContent)).toContain('Немецкий');

    await act(async () => {
      if (!select) return;
      select.value = 'Немецкий';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Добавить'))?.click();
    });

    const added = onProfileChange.mock.calls.at(-1)?.[0].languages.languages.at(-1);
    expect(added?.name).toBe('Немецкий');
  });

  it('asks for the name only when «Другой язык» is chosen', async () => {
    render(vi.fn());
    expect(host?.querySelector('#relocation-new-language-other')).toBeNull();
    await act(async () => {
      const select = host?.querySelector<HTMLSelectElement>('#relocation-new-language-name');
      if (!select) return;
      select.value = 'other';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host?.querySelector('#relocation-new-language-other')).not.toBeNull();
  });

  function render(onProfileChange: (profile: RelocationQuestionnaire) => void) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <LanguagesForm
          step="languages"
          profile={emptyRelocationQuestionnaire()}
          onProfileChange={onProfileChange}
          onImportLinkedIn={() => undefined}
          importBusy={false}
        />,
      ),
    );
  }
});
