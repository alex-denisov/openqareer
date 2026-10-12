import type { MockCareerDiaryFixture } from './mockSignedInCabinet';

export const verifiedDiaryWorkplace = {
  id: 'workplace-verified-fixture',
  company: 'FinCloud',
  title: 'Руководитель продукта',
  startDate: '2022-03-01',
  endDate: null,
  sourceExperienceId: 'exp-1',
  status: 'active',
  isPrimary: true,
  createdAt: '2022-03-01T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z',
};

const verifiedProfileExperience = {
  id: verifiedDiaryWorkplace.sourceExperienceId,
  chronologyMemoryId: 'm-resp-1',
  title: verifiedDiaryWorkplace.title,
  employer: verifiedDiaryWorkplace.company,
  current: true,
  startDate: '2022-03',
  bulletMemoryIds: ['m-out-1', 'm-out-2'],
};

export function verifiedCareerDiaryFixture(asOf: string): MockCareerDiaryFixture {
  return {
    overview: {
      asOf,
      primaryWorkplace: verifiedDiaryWorkplace,
      summary: {
        goalsAchieved: 0,
        goalsAtRisk: 0,
        goalsTotal: 0,
        achievementsReadyToAdd: 0,
        weeklyReviewsTotal: 0,
        weeklyReviewsInRow: 0,
      },
    },
    goals: [],
    workplace: verifiedDiaryWorkplace,
    workplaces: [verifiedDiaryWorkplace],
    profileExperience: verifiedProfileExperience,
  };
}
