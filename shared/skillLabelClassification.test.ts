import { describe, expect, it } from 'vitest';
import {
  skillCategoryForLabel,
  skillFamilyForLabel,
  SKILL_LABEL_CLASSIFICATION_VERSION,
} from './skillLabelClassification';
describe('B265 exact-label classification', () => {
  it('classifies approved dictionary names in both families without frequency or profile context', () => {
    expect(SKILL_LABEL_CLASSIFICATION_VERSION).toBe('b265_skill_categories_v1');
    for (const name of ['  SQL ', 'TypeScript', 'Kubernetes', 'AWS', 'CI/CD'])
      expect(skillFamilyForLabel(name)).toBe('technical');
    for (const name of ['Roadmapping', 'PCI DSS', 'People Management', 'Product Strategy', 'GDPR'])
      expect(skillFamilyForLabel(name)).toBe('profile');
    expect(skillCategoryForLabel('  SQL ')?.label).toBe('Языки и фреймворки');
  });
  it('keeps punctuation and unrecognized labels unconfirmed rather than inventing a category', () => {
    for (const name of [
      'C',
      'C++',
      'C#',
      'Node.js',
      'SQL Server',
      'Communication',
      'Familiarity with AWS',
      'ＳＱＬ',
      '',
    ])
      expect(skillFamilyForLabel(name)).toBe('unconfirmed');
    expect(skillFamilyForLabel('PCI-DSS')).toBe('unconfirmed');
    expect(skillFamilyForLabel('PCI DSS')).toBe('profile');
  });
});
