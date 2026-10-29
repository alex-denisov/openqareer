import { describe, expect, it } from 'vitest';
import { skillVerification } from './ProfileDesktopSkills';
import { mobileSkillLabels, skillSourceLabel } from './ProfileMobileSkills';

const confirmation = {
  id: 's',
  name: 'Kafka',
  status: null,
  source: null,
  verifiedAt: null,
  quizCheckable: true,
  lastAttempt: null,
  conversation: { name: 'Kafka', state: 'not_checked' as const, facts: [] },
};
const skill = (status?: string, source?: string) => ({ id: 's', name: 'Kafka', status, source });

describe('skill verification labels follow mockup 2', () => {
  it('1440 names the three states and never shows a raw status code', () => {
    expect(skillVerification(skill('подтверждён')).label).toBe('Подтверждено');
    expect(skillVerification(skill('не подтверждён')).label).toBe('Квиз не пройден');
    expect(skillVerification(skill()).label).toBe('Без квиза');
    expect(skillVerification(skill('awaiting_candidate_confirmation')).label).toBe('Без квиза');
    const failed = { ...confirmation, lastAttempt: { at: 'x', scorePercent: 40, passed: false } };
    expect(skillVerification(skill(), failed).label).toBe('Квиз не пройден');
    const discussed = {
      ...confirmation,
      conversation: { name: 'Kafka', state: 'discussed' as const, facts: [] },
    };
    expect(skillVerification(skill(), discussed).label).toBe('Разобрано в беседе');
  });

  it('390 reads «status · source, date» with its own wording', () => {
    expect(mobileSkillLabels(skill('подтверждён', 'квиз')).status).toBe('Подтверждён');
    expect(mobileSkillLabels(skill('не подтверждён', 'из LinkedIn')).status).toBe(
      'Квиз не пройден',
    );
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
