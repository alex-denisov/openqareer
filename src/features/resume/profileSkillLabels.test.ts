import { describe, expect, it } from 'vitest';
import { skillVerification } from './ProfileDesktopSkills';
import { mobileSkillLabels } from './ProfileMobileSkills';

const skill = (status?: string, source?: string) => ({ id: 's', name: 'Kafka', status, source });

describe('skill verification labels follow mockup 2', () => {
  it('1440 names the three states and never shows a raw status code', () => {
    expect(skillVerification(skill('подтверждён')).label).toBe('Подтверждено');
    expect(skillVerification(skill('не подтверждён')).label).toBe('Не подтверждено');
    expect(skillVerification(skill()).label).toBe('Квиз не пройден');
    expect(skillVerification(skill('awaiting_candidate_confirmation')).label).toBe(
      'Квиз не пройден',
    );
  });

  it('390 reads «status · source, date» with its own wording', () => {
    expect(mobileSkillLabels(skill('подтверждён', 'квиз')).status).toBe('Подтверждён');
    expect(mobileSkillLabels(skill('не подтверждён', 'из LinkedIn')).status).toBe('Не проверен');
    expect(mobileSkillLabels(skill('awaiting_candidate_confirmation')).status).toBe('Без квиза');
    expect(mobileSkillLabels(skill(undefined, 'со слов кандидата')).origin).toBe(
      'со слов кандидата',
    );
  });
});
