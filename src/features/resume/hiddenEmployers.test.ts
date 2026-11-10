import { describe, expect, it } from 'vitest';
import { asksEmployerName, hiddenEmployerPlaces } from './hiddenEmployers';

/** Работодатели профиля владельца на проде (10.11): три маски LinkedIn. */
const OWNER = [
  { id: 'e1', employer: 'OptiLab AI' },
  { id: 'e2', employer: 'Enterprise Energy IT Services' },
  { id: 'e3', employer: 'Enterprise Energy IT Services' },
  { id: 'e4', employer: 'Enterprise Public Cloud Platform (IaaS / PaaS)' },
  { id: 'e5', employer: 'Fishance Berhad' },
  { id: 'e6', employer: 'Corporate University of a Top-Tier Financial Institution' },
  { id: 'e7', employer: 'Kaspersky' },
];

describe('hiddenEmployerPlaces (B640)', () => {
  it('на профиле владельца три скрытых названия, по одному на компанию', () => {
    expect(hiddenEmployerPlaces(OWNER).map((place) => place.id)).toEqual(['e2', 'e4', 'e6']);
  });

  it('ответ снимает вопрос: настоящее название или «это и есть название»', () => {
    expect(
      asksEmployerName({ employer: OWNER[1]!.employer, employerRealName: 'Россети Цифра' }),
    ).toBe(false);
    expect(asksEmployerName({ employer: OWNER[1]!.employer, employerMaskKept: true })).toBe(false);
    expect(asksEmployerName({ employer: '' })).toBe(false);
    expect(asksEmployerName({ employer: 'Kaspersky' })).toBe(false);
  });
});
