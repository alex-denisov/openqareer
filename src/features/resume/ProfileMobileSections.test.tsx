// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileMobileAbout } from './ProfileMobileAbout';
import { ProfileMobileAts } from './ProfileMobileReadiness';
import { ProfileMobileLanguages } from './ProfileMobileCollections';
import { ProfileMobileReview } from './ProfileMobileReview';
import type { ProfileMobileDataProps } from './profileMobileTypes';

const base: ProfileMobileDataProps = {
  candidateId: 'mobile-profile-test',
  memory: [],
  onRetry: vi.fn(),
  onDraftChange: vi.fn(),
  onSectionSave: vi.fn(),
  draft: {
    candidate: { fullName: 'Тест', about: 'Текст кандидата' },
    experience: [],
    education: [],
    languages: [],
  },
};
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function button(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found).toBeDefined();
  return found!;
}

describe('separate mobile profile sections', () => {
  it('retains the About form and candidate text after a rejected save', async () => {
    const save = vi.fn().mockResolvedValue(false);
    const container = render(<ProfileMobileAbout {...base} onSectionSave={save} />);
    act(() => button(container, 'Изменить текст').click());
    await act(async () => button(container, 'Сохранить').click());
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector('textarea')?.value).toBe('Текст кандидата');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('opens the real About consultant action without manufacturing a suggestion', () => {
    const suggest = vi.fn();
    const container = render(
      <ProfileMobileAbout {...base} onSuggestAboutWithConsultant={suggest} />,
    );
    act(() => button(container, 'Предложить вариант с консультантом').click());
    expect(suggest).toHaveBeenCalledOnce();
    expect(container.querySelector('.career-consultant-suggestion')).toBeNull();
  });

  it('shows an explicit native language while keeping unknown levels ungraded', () => {
    const container = render(
      <ProfileMobileLanguages
        {...base}
        draft={{
          ...base.draft,
          languages: [
            {
              id: 'russian-native',
              evidenceMemoryId: 'memory-russian-native',
              name: 'Русский',
              sourceLabel: ' родной ',
            },
            {
              id: 'french-unknown',
              evidenceMemoryId: 'memory-french',
              name: 'Французский',
              sourceLabel: 'почти родной',
            },
            {
              id: 'english-cefr',
              evidenceMemoryId: 'memory-english',
              name: 'Английский',
              cefr: 'C1',
              sourceLabel: 'родной',
            },
          ],
        }}
      />,
    );
    const rows = [...container.querySelectorAll<HTMLButtonElement>('.pm-row')];

    expect(rows[0]?.querySelector('.pm-main b')?.textContent).toBe('Русский');
    expect(rows[0]?.querySelector('.pm-val')?.textContent).toBe('родной');
    expect(rows[1]?.querySelector('.pm-main b')?.textContent).toBe('Французский');
    expect(rows[1]?.querySelector('.pm-val')?.textContent).toBe('Уровень не указан');
    expect(rows[2]?.querySelector('.pm-main b')?.textContent).toBe('Английский');
    expect(rows[2]?.querySelector('.pm-val')?.textContent).toContain('C1');
    expect(rows[2]?.querySelector('.pm-val')?.textContent).not.toContain('родной');
  });

  it('keeps unmeasured ATS unknown and retries the actual failed request', () => {
    const refresh = vi.fn();
    const container = render(
      <ProfileMobileAts
        {...base}
        ats={{ assessment: null, sourceVersion: null, loading: false, error: 'Нет связи', refresh }}
      />,
    );
    // D4: a failed assessment hides the scale; only the error line and retry stay.
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.querySelector('.profile-mobile-gauge-value')).toBeNull();
    expect(container.querySelectorAll('.pm-cat.is-unknown')).toHaveLength(4);
    act(() => button(container, 'Повторить').click());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('takes a review finding to the actual experience screen', () => {
    const open = vi.fn();
    const container = render(<ProfileMobileReview {...base} open={open} back={vi.fn()} />);
    const experience = [...container.querySelectorAll<HTMLButtonElement>('.pm-row')].find(
      (row) => row.querySelector('b')?.textContent === 'Опыт',
    );
    expect(experience).toBeDefined();
    act(() => experience!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith({ page: 'exp' });
  });
});
