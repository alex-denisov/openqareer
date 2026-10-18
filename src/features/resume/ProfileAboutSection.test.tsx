// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
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
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(120);
    const originalStyle = window.getComputedStyle;
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalStyle(element);
      style.lineHeight = '24px';
      return style;
    });
    act(() => root.render(<ProfileAboutSection draft={draft} onSectionSave={() => undefined} />));

    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(container.querySelector('.profile-about-text')?.classList.contains('is-clamped')).toBe(
      true,
    );
    expect(container.textContent).toContain('Строка четвёртая.');
    act(() => toggle.click());
    expect(container.textContent).toContain('Строка четвёртая.');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.profile-about-text')?.classList.contains('is-open')).toBe(
      true,
    );

    act(() => toggle.click());
    expect(container.querySelector('.profile-about-text')?.classList.contains('is-clamped')).toBe(
      true,
    );
    expect(container.textContent).toContain('Строка четвёртая.');
    act(() => root.unmount());
    container.remove();
    scrollHeight.mockRestore();
    computedStyle.mockRestore();
  });

  it('shows the full About text without an excerpt toggle in detail mode', () => {
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
    act(() =>
      root.render(<ProfileAboutSection draft={draft} onSectionSave={() => undefined} detailView />),
    );

    expect(container.textContent).toContain('Строка четвёртая.');
    expect(container.textContent).not.toContain('Показать полностью');
    act(() => root.unmount());
    container.remove();
  });

  it('does not offer a fabricated consultant proposal when no real handler is wired', () => {
    const draft: ResumeDraft = {
      candidate: { fullName: 'Марина Соколова', about: 'Управляю инженерной командой.' },
      experience: [],
      education: [],
      languages: [],
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProfileAboutSection draft={draft} onSectionSave={() => undefined} />));

    expect(container.querySelector('[data-testid="about-consultant-suggest-btn"]')).toBeNull();
    expect(container.textContent).not.toContain('Консультант сформулировал управленческий масштаб');

    act(() => root.unmount());
    container.remove();
  });

  it('keeps the About editor open with its text when saving fails', async () => {
    const save = vi.fn().mockResolvedValue(false);
    const draft: ResumeDraft = {
      candidate: { fullName: 'Марина Соколова', about: 'Фактический текст раздела.' },
      experience: [],
      education: [],
      languages: [],
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProfileAboutSection draft={draft} onSectionSave={save} />));

    act(() =>
      (container.querySelector('[aria-label="Изменить «Обо мне»"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (container.querySelector('.career-primary-button') as HTMLButtonElement).click(),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="about-edit-textarea"]')?.value,
    ).toBe('Фактический текст раздела.');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
