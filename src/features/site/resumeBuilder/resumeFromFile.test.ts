import { describe, expect, it } from 'vitest';
import { builderFromParsed, monthYear } from './resumeFromFile';
import type { ParsedResume } from '../../workspace/resumeParserTypes';

describe('resume file → builder fields (B567)', () => {
  it.each([
    ['2021-03', '03.2021'],
    ['3.2021', '03.2021'],
    ['март 2021', '03.2021'],
    ['мая 2019', '05.2019'],
    ['Mar 2021', '03.2021'],
    ['2021', ''],
    [undefined, ''],
  ])('%s → %s', (input, expected) => {
    expect(monthYear(input)).toBe(expected);
  });

  it('maps experience, education and skills', () => {
    const parsed = {
      fullName: 'Анна Соколова',
      targetRole: 'Главный бухгалтер',
      contact: { email: 'anna@example.com', links: [] },
      experience: [
        {
          title: 'Главный бухгалтер',
          employer: 'ООО «Север»',
          startDate: '2021-03',
          current: true,
          responsibilities: ['Учёт'],
          achievements: ['Закрытие за 6 дней'],
        },
      ],
      education: [{ institution: 'Финуниверситет', qualification: 'Бакалавр', endDate: '2017-06' }],
      skills: ['1С', 'МСФО'],
      courses: [],
      tests: [],
      recommendations: [],
      languages: [],
      rawText: '',
    } satisfies ParsedResume;
    const resume = builderFromParsed(parsed);
    expect(resume.jobs[0]).toMatchObject({
      company: 'ООО «Север»',
      start: '03.2021',
      current: true,
    });
    expect(resume.jobs[0].bullets).toEqual(['Закрытие за 6 дней', 'Учёт']);
    expect(resume.education[0]).toEqual({
      school: 'Финуниверситет',
      degree: 'Бакалавр',
      year: '2017',
    });
    expect(resume.skills).toBe('1С, МСФО');
  });
});
