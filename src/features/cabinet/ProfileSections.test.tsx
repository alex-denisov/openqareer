import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileExperience, ProfileSkills, ProfileEducation, ProfileAbout } from './ProfileSections';
import type { CandidateProfileView } from './profileView';

/**
 * «Главная» по макету «Пульт»: места работы карточками с датами,
 * длительностью, пунктами и счётом измеримых пунктов (B179). До этого экран
 * печатал плоский список записей памяти, и разобранное резюме на нём не
 * читалось вовсе.
 */
const view: CandidateProfileView = {
  fullName: 'Alexey Denisov',
  targetRole: 'VP of Technology',
  location: 'Dubai, United Arab Emirates',
  about: 'I build, scale, and transform technology organizations.',
  experience: [
    {
      id: 'exp-2',
      title: 'VP of Technology & IT Operations',
      employer: 'Enterprise Energy IT Services',
      period: 'апрель 2023 — октябрь 2025',
      duration: '2 г. 7 мес.',
      current: false,
      bullets: ['Grew combined revenue 4x', 'Owned IT and cloud operations'],
      measurableBullets: 1,
    },
  ],
  totalExperience: '1 место',
  skills: ['Executive Leadership', 'ITIL 4 & DevOps'],
  education: [
    {
      id: 'edu-1',
      institution: 'Universitatea Tehnică a Moldovei',
      qualification: 'Bachelor of Engineering',
      period: '2005 — 2010',
    },
  ],
  languages: ['English'],
};

describe('ProfileExperience', () => {
  it('печатает место работы так, как его разобрали из резюме', () => {
    const html = renderToStaticMarkup(<ProfileExperience view={view} onImprove={() => undefined} />);

    expect(html).toContain('VP of Technology &amp; IT Operations');
    expect(html).toContain('Enterprise Energy IT Services');
    expect(html).toContain('апрель 2023 — октябрь 2025');
    expect(html).toContain('2 г. 7 мес.');
    expect(html).toContain('Grew combined revenue 4x');
  });

  it('называет счёт измеримых пунктов, а не рисует оценку блока', () => {
    const html = renderToStaticMarkup(<ProfileExperience view={view} onImprove={() => undefined} />);

    expect(html).toContain('1 из 2 пунктов с измеримым результатом');
  });

  it('пустой опыт не выдаёт себя за заполненный', () => {
    const html = renderToStaticMarkup(
      <ProfileExperience view={{ ...view, experience: [] }} onImprove={() => undefined} />,
    );

    expect(html).toContain('Опыт работы не заполнен');
  });
});

describe('остальные разделы профиля', () => {
  it('навыки приходят из резюме', () => {
    const html = renderToStaticMarkup(<ProfileSkills view={view} />);
    expect(html).toContain('Executive Leadership');
    expect(html).toContain('ITIL 4 &amp; DevOps');
  });

  it('образование печатается с периодом', () => {
    const html = renderToStaticMarkup(<ProfileEducation view={view} />);
    expect(html).toContain('Universitatea Tehnică a Moldovei');
    expect(html).toContain('2005 — 2010');
  });

  it('«о себе» и языки приходят из резюме', () => {
    const html = renderToStaticMarkup(<ProfileAbout view={view} />);
    expect(html).toContain('transform technology organizations');
    expect(html).toContain('English');
  });
});
