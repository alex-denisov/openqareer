import { describe, expect, it } from 'vitest';
import { coverLetterPrompt } from './coverLetterWriting';
import { letterProfileText } from './letterProfile';
import type { ResumeDraft } from './resumeDraft';
import { detectVacancyLanguage } from './vacancyPitchService';

const fact = (id: string, statement: string, extra = {}) => ({
  id,
  statement,
  kind: 'fact',
  domain: 'outcome',
  status: 'confirmed' as const,
  sourceMessageIds: ['m'],
  ...extra,
});
const draft = {
  candidate: {},
  experience: [{ id: 'e', title: 'CTO', employer: 'Acme', bulletMemoryIds: ['b'], skills: [] }],
  skills: [
    { id: '1', name: 'Docker' },
    { id: '2', name: 'Terraform' },
    { id: '3', name: 'Go' },
  ],
  education: [],
  courses: [{ id: 'c', name: 'DevOps: Docker, Terraform' }],
} as unknown as ResumeDraft;

describe('письмо: желаемое и учёба не опыт', () => {
  const text = letterProfileText({
    draft,
    facts: [
      fact('b', 'Moved services to Docker in 2022'),
      fact('w', 'Желаемая отрасль кандидата — FinTech', { domain: 'preference' }),
    ],
  });
  it('желаемая отрасль в профиль письма не идёт', () => expect(text).not.toContain('FinTech'));
  it('навык только из курса не в списке навыков, из работы — остаётся', () =>
    expect(text).toContain('SKILLS: Docker, Go'));
  it('запрос запрещает выдавать учёбу за опыт', () =>
    expect(coverLetterPrompt({ vacancy: 'v', profile: 'p' })).toContain(
      'учебные программы опытом не называй',
    ));
});

describe('язык вакансии — по тексту', () => {
  const base = { id: 'v', title: 'Head of Engineering' };
  it('русский полный текст при английском заголовке и сводке', () =>
    expect(
      detectVacancyLanguage({
        ...base,
        description: 'Lead the team of engineers',
        fullDescription: 'Ищем руководителя разработки в продуктовую команду, Kubernetes',
      }),
    ).toBe('ru'));
  it('английский текст с русским заголовком', () =>
    expect(
      detectVacancyLanguage({
        id: 'v',
        title: 'Директор',
        description: 'We are looking for an engineering leader',
      }),
    ).toBe('en'));
  it('без текста решает заголовок', () => expect(detectVacancyLanguage(base)).toBe('en'));
});
