// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import type { CandidateMemory } from '../coach/coachApi';
import {
  ConfirmExperienceButton,
  experienceConfirmation,
  experienceConfirmationLabel,
} from './ExperienceConfirmation';
import { ProfileHistoryList, ProfileHistorySection } from './ProfileHistory';
import type { ProfileHistoryItem } from './profileHistoryApi';

const api = vi.hoisted(() => ({
  getProfileHistory: vi.fn(),
  revertProfileHistoryEntry: vi.fn(),
  confirmProfileExperience: vi.fn(),
}));
vi.mock('./profileHistoryApi', () => api);

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});

const entry: ProfileHistoryItem = {
  id: 'change-1',
  actor: 'consultant',
  section: 'experience',
  kind: 'value',
  itemId: 'exp-1',
  label: 'Lead · Acme',
  previousText: 'Ускорил релизы.',
  appliedText: 'Сократил время релиза с недели до дня.',
  createdAt: '2026-11-01T09:30:00.000Z',
  revertedAt: null,
};

async function render(node: React.ReactNode = <ProfileHistoryList />) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('ProfileHistoryList', () => {
  it('shows the empty state when nothing changed yet', async () => {
    api.getProfileHistory.mockResolvedValue({ entries: [], total: 0, page: 0, pageSize: 20 });
    const container = await render();
    expect(container.textContent).toContain('Изменений пока нет');
  });

  it('shows who, where and «было → стало», and loads the next page of 20', async () => {
    api.getProfileHistory.mockResolvedValueOnce({
      entries: [entry],
      total: 21,
      page: 0,
      pageSize: 20,
    });
    api.getProfileHistory.mockResolvedValueOnce({
      entries: [{ ...entry, id: 'change-2', actor: 'candidate' }],
      total: 21,
      page: 1,
      pageSize: 20,
    });
    const container = await render();
    expect(container.textContent).toContain('Консультант');
    expect(container.textContent).toContain('Опыт · Lead · Acme');
    expect(container.querySelector('del')?.textContent).toBe('Ускорил релизы.');
    const more = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Показать ещё'),
    );
    await act(async () => more?.click());
    expect(api.getProfileHistory).toHaveBeenLastCalledWith(1, undefined);
    expect(container.querySelectorAll('[data-testid="profile-history-row"]')).toHaveLength(2);
  });

  it('says why «Вернуть» was refused when the value changed since', async () => {
    api.getProfileHistory.mockResolvedValue({ entries: [entry], total: 1, page: 0, pageSize: 20 });
    api.revertProfileHistoryEntry.mockRejectedValue(
      new CoachApiError('С тех пор это место изменилось.', 'profile_change_conflict', false),
    );
    const container = await render();
    const revert = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Вернуть'),
    );
    await act(async () => revert?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('изменилось');
  });
});

describe('ProfileHistoryList confirmation entries', () => {
  it('reads a short summary, keeps bullets behind «Показать изменения», no «было: —»', async () => {
    api.getProfileHistory.mockResolvedValue({
      entries: [
        {
          ...entry,
          kind: 'confirmation',
          previousText: '',
          appliedText: 'Место работы подтверждено: Acme, Lead',
          details: ['Сократил время релиза.', 'Вырастил команду.'],
        },
      ],
      total: 1,
      page: 0,
      pageSize: 20,
    });
    const container = await render();
    const row = container.querySelector('[data-testid="profile-history-row"]')!;
    expect(row.textContent).toContain('Место работы подтверждено: Acme, Lead');
    expect(row.textContent).not.toContain('было');
    const disclosure = row.querySelector('details')!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')!.textContent).toBe('Показать изменения');
    expect(disclosure.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('experience confirmation label', () => {
  const fact = (id: string, extra: Partial<CandidateMemory> = {}): CandidateMemory => ({
    id,
    kind: 'fact',
    domain: 'outcome',
    statement: id,
    confidence: 'candidate-confirmed',
    sourceMessageIds: [],
    sensitive: false,
    status: 'confirmed',
    ...extra,
  });
  const place = {
    id: 'exp-1',
    chronologyMemoryId: 'chrono',
    current: false,
    bulletMemoryIds: ['a', 'b'],
  };

  it('reads «Подтверждено вами · с консультантом DD.MM» after an accept', () => {
    const memory = [fact('a', { consultantConfirmedAt: '2026-11-01T09:30:00.000Z' }), fact('b')];
    expect(experienceConfirmationLabel(experienceConfirmation(place, memory))).toBe(
      'Подтверждено вами · с консультантом 01.11',
    );
  });

  it('stays unconfirmed while any bullet is only reported', () => {
    const memory = [fact('a'), fact('b', { confidence: 'candidate-reported' })];
    expect(experienceConfirmationLabel(experienceConfirmation(place, memory))).toBe(
      'Не подтверждено вами',
    );
  });
});

const rows = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid="profile-history-row"]');
const buttonWith = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text));

describe('История изменений, owner 02.11', () => {
  it('is folded and reads nothing until opened', async () => {
    api.getProfileHistory.mockResolvedValue({ entries: [entry], total: 1, page: 0, pageSize: 20 });
    const container = await render(<ProfileHistorySection />);
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(api.getProfileHistory).not.toHaveBeenCalled();
    await act(async () => {
      details!.open = true;
      details!.dispatchEvent(new Event('toggle'));
    });
    expect(api.getProfileHistory).toHaveBeenCalledTimes(1);
    expect(rows(container)).toHaveLength(1);
  });

  it('opens on the five newest and grows by «Показать ещё»', async () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({ ...entry, id: `c-${index}` }));
    api.getProfileHistory.mockResolvedValue({ entries, total: 7, page: 0, pageSize: 20 });
    const container = await render();
    expect(rows(container)).toHaveLength(5);
    await act(async () => buttonWith(container, 'Показать ещё 2')?.click());
    expect(rows(container)).toHaveLength(7);
    expect(api.getProfileHistory).toHaveBeenCalledTimes(1);
    expect(buttonWith(container, 'Показать ещё')).toBeUndefined();
  });
});

describe('ConfirmExperienceButton', () => {
  it('ties the real error to the button and re-reads the profile anyway', async () => {
    api.confirmProfileExperience.mockRejectedValue(
      new CoachApiError('Место работы не найдено.', 'experience_not_found', false),
    );
    const onConfirmed = vi.fn();
    const container = await render(
      <ConfirmExperienceButton experienceId="exp-1" onConfirmed={onConfirmed} />,
    );
    await act(async () => buttonWith(container, 'Подтвердить')?.click());
    const button = container.querySelector('button')!;
    const error = container.querySelector('[role="alert"]')!;
    expect(error.textContent).toBe('Место работы не найдено.');
    expect(button.getAttribute('aria-describedby')).toBe(error.id);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
});
