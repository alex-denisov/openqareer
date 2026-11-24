import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { withSkill } from './skillAddModel';

const draft = { skills: [{ id: 's1', name: 'Go' }] } as unknown as ResumeDraft;

describe('b640 profile: «Добавить навык» (s01)', () => {
  it('добавляет в конец, не меняя исходный профиль', () => {
    const next = withSkill(draft, '  Terraform  Cloud ', 's2');
    expect(next.skills).toEqual([
      { id: 's1', name: 'Go' },
      { id: 's2', name: 'Terraform Cloud' },
    ]);
    expect(draft.skills).toHaveLength(1);
  });

  it('пустое имя и повтор без учёта регистра ничего не меняют', () => {
    expect(withSkill(draft, '  ', 's2')).toBe(draft);
    expect(withSkill(draft, 'GO', 's2')).toBe(draft);
  });
});
