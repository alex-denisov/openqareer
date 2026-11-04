import { describe, expect, it } from 'vitest';
import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import {
  FragmentChainStructurer,
  FragmentedResumeStructurer,
  type ResumeStructurer,
} from './resumeStructurer';
import {
  mergeResumeFragments,
  RESUME_CONTINUED_TITLE,
  RESUME_WHOLE_READ_MAX_CHARACTERS,
  splitResumeIntoFragments,
} from './resumeFragments';

const empty: ParsedResume = {
  contact: { links: [] },
  experience: [],
  skills: [],
  education: [],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [],
  rawText: '',
};

const place = (title: string, startDate: string | undefined, bullets: string[]) => ({
  title,
  employer: `${title} Inc`,
  startDate,
  current: false,
  responsibilities: bullets,
  achievements: [],
});

const longResume = (places: number) =>
  Array.from({ length: places }, (_, i) =>
    [
      `Role ${i}`,
      `Employer ${i}`,
      `Jan ${2000 + i} - Dec ${2000 + i}`,
      ...Array.from({ length: 8 }, (_, b) => `- bullet ${i}.${b} ${'x'.repeat(100)}`),
      '',
    ].join('\n'),
  ).join('\n');

describe('splitResumeIntoFragments', () => {
  it('keeps a short resume whole', () => {
    expect(splitResumeIntoFragments('a'.repeat(RESUME_WHOLE_READ_MAX_CHARACTERS))).toHaveLength(1);
  });

  it('loses no line, and each place heading stays with its dates', () => {
    const source = longResume(16);
    const fragments = splitResumeIntoFragments(source);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.length).toBeLessThanOrEqual(6);
    const joined = fragments.join('\n');
    for (const line of source.split('\n')) expect(joined).toContain(line);
    for (const fragment of fragments.slice(1)) expect(fragment.startsWith('Role ')).toBe(true);
  });

  it('cuts a document with no dates and no blank lines, and ends', () => {
    const source = Array.from({ length: 400 }, (_, i) => `plain line ${i} ${'y'.repeat(60)}`).join('\n');
    const fragments = splitResumeIntoFragments(source);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.join('\n')).toContain('plain line 399');
  });
});

describe('mergeResumeFragments', () => {
  it('joins a place repeated at a seam and keeps document order', () => {
    const merged = mergeResumeFragments(
      [
        { ...empty, fullName: 'Name', experience: [place('A', '2020', ['one']), place('B', '2018', ['two'])] },
        { ...empty, fullName: 'Wrong', experience: [place('B', '2018', ['two', 'three']), place('C', '2016', ['four'])] },
      ],
      'raw',
    );
    expect(merged.fullName).toBe('Name');
    expect(merged.rawText).toBe('raw');
    expect(merged.experience.map((item) => item.title)).toEqual(['A', 'B', 'C']);
    expect(merged.experience[1]?.responsibilities).toEqual(['two', 'three']);
  });

  it('gives bullets without a heading to the previous place', () => {
    const merged = mergeResumeFragments(
      [
        { ...empty, experience: [place('A', '2020', ['one'])] },
        { ...empty, experience: [{ ...place(RESUME_CONTINUED_TITLE, undefined, ['two']), employer: '' }] },
      ],
      'raw',
    );
    expect(merged.experience).toHaveLength(1);
    expect(merged.experience[0]?.title).toBe('A');
    expect(merged.experience[0]?.responsibilities).toEqual(['one', 'two']);
  });

  it('keeps two terms at one employer apart', () => {
    const merged = mergeResumeFragments(
      [
        { ...empty, experience: [place('A', '2020', ['one'])] },
        { ...empty, experience: [place('A', '2015', ['two'])] },
      ],
      'raw',
    );
    expect(merged.experience).toHaveLength(2);
  });

  it('unites skills and languages without repeats', () => {
    const merged = mergeResumeFragments(
      [
        { ...empty, skills: ['SQL', 'Go'] },
        { ...empty, skills: ['sql', 'Rust'], languages: [{ name: 'English', cefr: 'C1' }] },
      ],
      'raw',
    );
    expect(merged.skills).toEqual(['SQL', 'Go', 'Rust']);
    expect(merged.languages).toHaveLength(1);
  });
});

const fake = (answer: (text: string) => ParsedResume | null): ResumeStructurer => ({
  provenance: { model: 'm', promptRevision: 'r' },
  structure: async (text) => answer(text),
});

describe('FragmentedResumeStructurer', () => {
  it('reads a short resume whole', async () => {
    const reader = new FragmentedResumeStructurer(fake(() => ({ ...empty, fullName: 'whole' })), fake(() => null));
    expect((await reader.structure('short resume text'))?.fullName).toBe('whole');
  });

  it('merges a long resume and keeps the whole text as raw', async () => {
    const source = longResume(16);
    const reader = new FragmentedResumeStructurer(
      fake(() => null),
      fake((text) => ({ ...empty, skills: [text.slice(0, 6)] })),
    );
    const parsed = await reader.structure(source);
    expect(parsed?.rawText).toBe(source);
    expect(parsed?.skills.length).toBeGreaterThan(0);
  });

  it('fails the read when one fragment has no answer: the rules beat a silent gap', async () => {
    let calls = 0;
    const reader = new FragmentedResumeStructurer(
      fake(() => null),
      fake(() => {
        calls += 1;
        return calls === 2 ? null : { ...empty, skills: ['x'] };
      }),
    );
    expect(await reader.structure(longResume(16))).toBeNull();
  });
});

describe('FragmentChainStructurer', () => {
  it('counts an empty answer as a refusal and moves to the next stage (#428)', async () => {
    const chain = new FragmentChainStructurer([fake(() => empty), fake(() => ({ ...empty, skills: ['x'] }))]);
    expect((await chain.structure('text'))?.skills).toEqual(['x']);
  });

  it('accepts a fragment with languages only, without walking the whole chain', async () => {
    let second = 0;
    const chain = new FragmentChainStructurer([
      fake(() => ({ ...empty, languages: [{ name: 'English' }] })),
      fake(() => {
        second += 1;
        return null;
      }),
    ]);
    expect((await chain.structure('text'))?.languages).toHaveLength(1);
    expect(second).toBe(0);
  });

  it('answers null when every stage is empty', async () => {
    expect(await new FragmentChainStructurer([fake(() => empty), fake(() => null)]).structure('text')).toBeNull();
  });
});
