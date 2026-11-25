import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { formOf } from './experienceForm';
import { blankEntry, withNewEntry } from './newExperience';

const entry = blankEntry('e-new');
const form = { ...formOf(entry), employer: 'Арка', title: 'CTO', start: '2021-03', current: true };

describe('B801: «Заполнить вручную»', () => {
  it('первое место работы заводит и пустой профиль', () => {
    expect(withNewEntry(null, entry, form).experience).toMatchObject([
      { id: 'e-new', chronologyMemoryId: 'manual-e-new', employer: 'Арка', startDate: '2021-03' },
    ]);
  });

  it('остальной профиль не меняется, повтор не дублирует запись', () => {
    const old = { ...blankEntry('e1'), employer: 'Бета' };
    const draft = { ...withNewEntry(null, entry, form), experience: [old] } as ResumeDraft;
    const once = withNewEntry(draft, entry, form);
    const twice = withNewEntry(once, entry, { ...form, title: 'CIO' });
    expect(twice.experience.map(({ id, title }) => [id, title])).toEqual([
      ['e-new', 'CIO'],
      ['e1', undefined],
    ]);
    expect(twice.experience[1]).toBe(old);
  });
});
