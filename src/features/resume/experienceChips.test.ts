import { describe, expect, it } from 'vitest';
import { experienceChips, profileLanguage } from './experienceChips';
import type { ResumeExperienceInput } from './resumeTypes';

const entry = (patch: Partial<ResumeExperienceInput>): ResumeExperienceInput => ({
  id: 'e1',
  chronologyMemoryId: 'c1',
  title: 'VP of Technology',
  employer: 'Acme',
  startDate: '2023-04',
  current: false,
  bulletMemoryIds: [],
  ...patch,
});

const labels = (chips: ReturnType<typeof experienceChips>) => chips.map((chip) => chip.label);

describe('profileLanguage', () => {
  it('reads an English profile as en and a Russian one as ru', () => {
    expect(profileLanguage(['VP of Technology', 'I build technology organizations'])).toBe('en');
    expect(profileLanguage(['Руководитель ИТ', 'Строю команды разработки'])).toBe('ru');
  });
});

describe('experienceChips', () => {
  it('shows remote once, in the profile language (owner, 02.11)', () => {
    const remote = entry({ location: 'Remote', workplaceType: 'remote' });
    expect(labels(experienceChips(remote, [], 'en'))).toEqual(['Remote']);
    expect(labels(experienceChips(remote, [], 'ru'))).toEqual(['Удалённо']);
    const russian = entry({ location: 'Удаленно', workplaceType: 'remote' });
    expect(labels(experienceChips(russian, [], 'en'))).toEqual(['Remote']);
  });

  it('keeps a real city next to the work mode', () => {
    const office = entry({ location: 'Kedah, Malaysia', workplaceType: 'on_site' });
    expect(labels(experienceChips(office, [], 'en'))).toEqual(['Kedah, Malaysia', 'On-site']);
  });

  it('localizes the employment type and the current place', () => {
    const current = entry({ current: true, employmentType: 'Full-time' });
    expect(labels(experienceChips(current, [], 'en'))).toEqual(['Current', 'Full-time']);
    expect(labels(experienceChips(current, [], 'ru'))).toEqual([
      'Работаю здесь',
      'Полная занятость',
    ]);
  });

  it('drops the team size chip when the text already names the number', () => {
    const team = entry({ teamSize: 250 });
    expect(labels(experienceChips(team, ['Managed 250+ professionals'], 'en'))).toEqual([]);
    expect(labels(experienceChips(team, ['Built the support function'], 'en'))).toEqual([
      'Team: 250',
    ]);
    expect(labels(experienceChips(team, ['Команда 2500 человек'], 'ru'))).toEqual([
      'Команда: 250 человек',
    ]);
  });
});
