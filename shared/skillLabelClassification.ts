/** B265 exact-label dictionary, shared without changing candidate grouping behavior.
 * Unknown labels stay unconfirmed. Category says nothing about importance or ability.
 */
export const SKILL_LABEL_CLASSIFICATION_VERSION = 'b265_skill_categories_v1';
export type SkillLabelFamily = 'technical' | 'profile';
export const OTHER_SKILL_CATEGORY = 'Другое';

export const SKILL_CATEGORIES: readonly {
  label: string;
  family: SkillLabelFamily;
  match: readonly string[];
}[] = [
  {
    label: 'Управление и стратегия',
    family: 'profile',
    match: [
      'engineering leadership',
      'roadmapping',
      'stakeholder management',
      'hiring & team scaling',
      'hiring',
      'budget ownership',
      'okrs',
      'team scaling',
      'people management',
    ],
  },
  {
    label: 'Платформа и инфраструктура',
    family: 'technical',
    match: [
      'kubernetes',
      'aws',
      'terraform',
      'distributed systems',
      'observability',
      'ci/cd',
      'docker',
      'gcp',
      'azure',
    ],
  },
  {
    label: 'Языки и фреймворки',
    family: 'technical',
    match: [
      'go',
      'typescript',
      'python',
      'postgresql',
      'grpc',
      'react',
      'java',
      'javascript',
      'sql',
    ],
  },
  {
    label: 'Продукт и комплаенс',
    family: 'profile',
    match: [
      'fintech compliance',
      'pci dss',
      'payments',
      'risk management',
      'product strategy',
      'bafin audits',
      'gdpr',
    ],
  },
];

export function skillCategoryForLabel(name: string) {
  const key = name.trim().toLowerCase();
  return SKILL_CATEGORIES.find((category) => category.match.includes(key));
}
export function skillFamilyForLabel(name: string): SkillLabelFamily | 'unconfirmed' {
  return skillCategoryForLabel(name)?.family ?? 'unconfirmed';
}
