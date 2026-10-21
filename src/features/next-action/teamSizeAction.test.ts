import { describe, expect, it } from 'vitest';
import { buildTeamSizeAction } from './teamSizeAction';

const decision = {
  kind: 'team_size' as const,
  experienceId: 'exp-fintech',
  employer: 'Финтех Лаб',
  title: 'Head of Engineering',
  favoritesTotal: 18,
  favoritesAsking: 3,
  minTeamSize: 50,
  readAt: '2026-10-07T06:12:00.000Z',
};

describe('buildTeamSizeAction (B540, mockup 1)', () => {
  it('words the decision, both reasons and the effect from the data', () => {
    const action = buildTeamSizeAction(decision, 'Europe/Moscow');
    expect(action.headline).toBe('Подтвердите размер команды в «Финтех Лаб»');
    expect(action.label).toBe('Подтвердить факт');
    expect(action.destination).toBe('coach');
    expect(action.reasons).toEqual([
      {
        text: 'В профиле размер команды «неизвестно». От него зависит оценка уровня.',
        link: { label: 'Профиль, Опыт', target: 'profile-experience' },
      },
      {
        text: '3 из 18 избранных вакансий просят управлять от 50 человек; без этого факта совпадение по уровню не считается.',
        mobileText:
          '3 из 18 избранных вакансий просят управлять от 50 человек. Без этого факта совпадение по уровню не считается.',
        link: { label: 'Избранное', target: 'favorites' },
      },
    ]);
    expect(action.expectedChange).toBe('Откроется оценка уровня для 3 вакансий. Около 2 минут.');
    expect(action.sourcesLabel).toBe('профиль и избранное, 07.10 09:12');
    expect(action.profileFocus).toEqual({
      section: 'experience',
      experienceId: 'exp-fintech',
      employer: 'Финтех Лаб',
      title: 'Head of Engineering',
    });
    expect(action.findingIds).toEqual(['team-size:exp-fintech']);
  });

  it('declines vacancies by number', () => {
    const action = buildTeamSizeAction(
      { ...decision, favoritesAsking: 1, favoritesTotal: 1 },
      'UTC',
    );
    expect(action.reasons?.[1]?.text).toBe(
      '1 из 1 избранной вакансии просит управлять от 50 человек; без этого факта совпадение по уровню не считается.',
    );
    expect(action.expectedChange).toBe('Откроется оценка уровня для 1 вакансии. Около 2 минут.');
  });
});
