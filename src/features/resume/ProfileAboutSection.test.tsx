// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ProfileAboutSection } from './ProfileAboutSection';
import type { ResumeDraft } from './resumeTypes';

describe('ProfileAboutSection', () => {
  it('expands and collapses the three-line excerpt', () => {
    const draft: ResumeDraft = {
      candidate: {
        fullName: 'Марина Соколова',
        about: 'Строка первая.\nСтрока вторая.\nСтрока третья.\nСтрока четвёртая.',
      },
      experience: [],
      education: [],
      languages: [],
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProfileAboutSection draft={draft} onSectionSave={() => undefined} />));

    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(container.textContent).not.toContain('Строка четвёртая.');
    act(() => toggle.click());
    expect(container.textContent).toContain('Строка четвёртая.');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    act(() => toggle.click());
    expect(container.textContent).not.toContain('Строка четвёртая.');
    act(() => root.unmount());
    container.remove();
  });
});
