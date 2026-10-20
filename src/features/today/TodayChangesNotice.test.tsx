// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayChangesNotice } from './TodayChangesNotice';
import type { TodaySinceLastVisit } from './todayApi';
import { todayChangesSentence } from './todayFormat';

const SINCE = new Date(2026, 9, 5, 18, 40).toISOString();
const sinceLastVisit: TodaySinceLastVisit = {
  since: SINCE,
  items: [],
  changes: [
    { kind: 'vacancies', count: 14, role: 'Head of Engineering', at: SINCE },
    { kind: 'letter_opened', company: 'Вектор Банк', applicationId: 'app-1', at: SINCE },
  ],
};

function render(props: Partial<Parameters<typeof TodayChangesNotice>[0]> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onNavigate = vi.fn();
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  act(() => {
    createRoot(root).render(
      <TodayChangesNotice
        sinceLastVisit={sinceLastVisit}
        onNavigate={onNavigate}
        onDismiss={onDismiss}
        {...props}
      />,
    );
  });
  return { root, onNavigate, onDismiss };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Today changes strip (B542, mockup 1)', () => {
  it('reads like the mockup', () => {
    expect(todayChangesSentence(sinceLastVisit.changes ?? [])).toBe(
      '+14 вакансий подходят по роли, Вектор Банк открыл письмо.',
    );
    const { root } = render();
    expect(root.textContent).toBe(
      'С 05.10, 18:40: +14 вакансий подходят по роли, Вектор Банк открыл письмо. Смотреть',
    );
  });

  it('«Смотреть» opens the first event: vacancies, then the application', () => {
    const { root, onNavigate } = render();
    act(() => root.querySelector<HTMLButtonElement>('.career-today-changes-link')?.click());
    expect(onNavigate).toHaveBeenCalledWith('opportunities', {
      focusRoleFilter: true,
      focusFilter: 'role',
    });

    document.body.innerHTML = '';
    const letterOnly = render({
      sinceLastVisit: { ...sinceLastVisit, changes: sinceLastVisit.changes?.slice(1) },
    });
    act(() =>
      letterOnly.root.querySelector<HTMLButtonElement>('.career-today-changes-link')?.click(),
    );
    expect(letterOnly.onNavigate).toHaveBeenCalledWith('responses', { applicationId: 'app-1' });
  });

  it('«Скрыть уведомление» hides the strip through the server', async () => {
    const { root, onDismiss } = render();
    await act(async () => {
      root.querySelector<HTMLButtonElement>('[aria-label="Скрыть уведомление"]')?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('');
  });

  it('comes back when hiding fails on the server', async () => {
    const { root } = render({ onDismiss: vi.fn().mockRejectedValue(new Error('offline')) });
    await act(async () => {
      root.querySelector<HTMLButtonElement>('[aria-label="Скрыть уведомление"]')?.click();
    });
    expect(root.textContent).toContain('Вектор Банк открыл письмо');
  });

  it('is absent without changes', () => {
    const { root } = render({ sinceLastVisit: { ...sinceLastVisit, changes: [] } });
    expect(root.textContent).toBe('');
  });
});
