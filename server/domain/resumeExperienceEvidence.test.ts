import { describe, expect, it } from 'vitest';
import { experienceStatement } from './resumeExperienceEvidence';

const entry = {
  id: 'role-1',
  chronologyMemoryId: 'memory-role-1',
  title: 'Head of Engineering',
  employer: 'Финтех Лаб',
  current: true,
  bulletMemoryIds: [],
};

describe('experienceStatement', () => {
  it('records the team size the candidate confirmed (B540)', () => {
    expect(experienceStatement({ ...entry, teamSize: 38 })).toContain('Размер команды: 38 человек');
  });

  it('leaves an unknown team size out of the fact', () => {
    expect(experienceStatement(entry)).not.toContain('Размер команды');
  });
});
