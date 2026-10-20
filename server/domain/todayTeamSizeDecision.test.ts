import { describe, expect, it } from 'vitest';
import { buildTodayTeamSizeDecision } from './todayTeamSizeDecision';

const NOW = '2026-10-07T06:12:00.000Z';
const fintech = {
  id: 'exp-fintech',
  chronologyMemoryId: 'chronology-fintech',
  title: 'Head of Engineering',
  employer: 'Финтех Лаб',
  startDate: '2021-03',
  current: true,
  bulletMemoryIds: [],
};
const favorites = [
  { text: 'Head of Engineering. Управление командой от 50 человек.' },
  { text: 'CTO: опыт руководства командой от 80 человек' },
  { text: 'VP Engineering, teams of 60+ engineers' },
  { text: 'Опыт от 7 лет' },
  { text: '' },
];

describe('buildTodayTeamSizeDecision (B540)', () => {
  it('asks to confirm the current place team size when favorites require one', () => {
    expect(buildTodayTeamSizeDecision({ experience: [fintech], favorites, now: NOW })).toEqual({
      kind: 'team_size',
      experienceId: 'exp-fintech',
      employer: 'Финтех Лаб',
      title: 'Head of Engineering',
      favoritesTotal: 5,
      favoritesAsking: 3,
      minTeamSize: 50,
      readAt: NOW,
    });
  });

  it('stays silent when no favorite names a team size', () => {
    expect(
      buildTodayTeamSizeDecision({
        experience: [fintech],
        favorites: [{ text: 'Опыт от 7 лет' }],
        now: NOW,
      }),
    ).toBeNull();
  });

  it('stays silent when the current place already has a team size or there is none', () => {
    expect(
      buildTodayTeamSizeDecision({
        experience: [{ ...fintech, teamSize: 38 }],
        favorites,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      buildTodayTeamSizeDecision({
        experience: [{ ...fintech, current: false }],
        favorites,
        now: NOW,
      }),
    ).toBeNull();
  });
});
