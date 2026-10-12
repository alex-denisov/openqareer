import { describe, expect, it } from 'vitest';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import {
  careerDiaryProfileRoleChange,
  hasCurrentProfileExperience,
  shouldShowCareerDiary,
} from './careerDiaryAccess';

const workplace: CareerDiaryWorkplace = {
  id: 'workplace-current',
  company: 'Норма Групп',
  title: 'Head of Engineering',
  startDate: '2026-10-01',
  endDate: null,
  sourceExperienceId: 'experience-current',
  status: 'active',
  isPrimary: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('career diary visibility from profile work facts', () => {
  it('shows an entry point when the profile has current work before a diary record exists', () => {
    expect(hasCurrentProfileExperience([{ id: 'experience-current', current: true }])).toBe(true);
    expect(
      hasCurrentProfileExperience([
        { id: 'experience-old', current: false, endDate: '2026-11-30' },
      ]),
    ).toBe(false);
  });

  it('shows an active place when the linked profile experience is current', () => {
    expect(
      shouldShowCareerDiary(workplace, { id: 'experience-current', current: true }, '2026-12-01'),
    ).toBe(true);
  });

  it('uses the linked profile status before the diary record status', () => {
    expect(
      shouldShowCareerDiary(
        { ...workplace, status: 'archived' },
        { id: 'experience-current', current: true },
        '2026-12-01',
      ),
    ).toBe(true);
    expect(
      shouldShowCareerDiary(
        { ...workplace, status: 'archived' },
        { id: 'experience-current', current: false, endDate: '2026-11-30' },
        '2026-12-01',
      ),
    ).toBe(false);
    expect(
      shouldShowCareerDiary(
        workplace,
        { id: 'experience-current', current: false, endDate: '2026-11-30' },
        '2026-12-01',
      ),
    ).toBe(false);
  });

  it('hides an unlinked active diary when the profile has no current work fact', () => {
    expect(
      shouldShowCareerDiary(
        { ...workplace, sourceExperienceId: null },
        { id: 'experience-old', current: false, endDate: '2026-11-30' },
        '2026-12-01',
      ),
    ).toBe(false);
  });

  it('keeps an accepted future start date visible as an active offer', () => {
    expect(
      shouldShowCareerDiary(
        { ...workplace, startDate: '2026-12-20' },
        { id: 'experience-current', current: false },
        '2026-12-01',
      ),
    ).toBe(true);
  });

  it('asks how to handle a changed title when profile data provides a current role', () => {
    expect(
      careerDiaryProfileRoleChange(workplace, {
        id: 'experience-current',
        current: true,
        title: 'VP Engineering',
      }),
    ).toBe('VP Engineering');
    expect(careerDiaryProfileRoleChange(workplace, null)).toBeNull();
    expect(
      careerDiaryProfileRoleChange(workplace, {
        id: 'experience-current',
        current: true,
        title: 'Head of Engineering',
      }),
    ).toBeNull();
  });
});
