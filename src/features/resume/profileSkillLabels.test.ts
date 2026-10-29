import { describe, expect, it } from 'vitest';
import { skillVerification } from './ProfileDesktopSkills';
import { mobileSkillLabels, skillSourceLabel } from './ProfileMobileSkills';

const skill = (status?: string, source?: string) => ({ id: 's', name: 'Kafka', status, source });

describe('skill verification labels follow mockup 2', () => {
  it('1440 names the three states and never shows a raw status code', () => {
    expect(skillVerification(skill('подтверждён')).label).toBe('Подтверждено');
    expect(skillVerification(skill('не подтверждён')).label).toBe('Не подтверждено');
    // B3: no quiz was ever started for such a skill, so it is «Без квиза», not a failed quiz.
    expect(skillVerification(skill()).label).toBe('Без квиза');
    expect(skillVerification(skill('awaiting_candidate_confirmation')).label).toBe('Без квиза');
  });

  it('390 reads «status · source, date» with its own wording', () => {
    expect(mobileSkillLabels(skill('подтверждён', 'квиз')).status).toBe('Подтверждён');
    expect(mobileSkillLabels(skill('не подтверждён', 'из LinkedIn')).status).toBe('Не проверен');
    expect(mobileSkillLabels(skill('awaiting_candidate_confirmation')).status).toBe('Без квиза');
    expect(mobileSkillLabels(skill(undefined, 'со слов кандидата')).origin).toBe(
      'со слов кандидата',
    );
  });

  it('names the import a skill came from when the skill has no own source label', () => {
    const labelOf = (id: string | undefined) =>
      id === 'm1' ? 'из LinkedIn, 25.09' : 'источник неизвестен';
    expect(skillSourceLabel({ ...skill(), evidenceMemoryId: 'm1' }, labelOf)).toBe(
      'из LinkedIn, 25.09',
    );
    expect(skillSourceLabel({ ...skill(), evidenceMemoryId: 'gone' }, labelOf)).toBe(
      'Источник не указан',
    );
    expect(skillSourceLabel(skill(), labelOf)).toBe('Источник не указан');
    expect(skillSourceLabel({ ...skill(undefined, 'квиз'), evidenceMemoryId: 'm1' }, labelOf)).toBe(
      'квиз',
    );
    expect(mobileSkillLabels({ ...skill(), evidenceMemoryId: 'm1' }, labelOf).origin).toBe(
      'из LinkedIn, 25.09',
    );
  });
});
