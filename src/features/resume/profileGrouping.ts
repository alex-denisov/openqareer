import type { ResumeExperienceInput, ResumeSkillInput } from './resumeTypes';

export interface ExperienceEmployerGroup {
  readonly key: string;
  readonly employer: string;
  readonly location?: string;
  readonly positions: readonly ResumeExperienceInput[];
}

/**
 * Groups roles held at the same employer the way the mockup's `.company-group`
 * expects: consecutive draft entries sharing an `employerGroupKey` (preferred,
 * B265 v2) or the same trimmed employer name collapse under one heading. Two
 * unrelated stints at the same-named employer years apart still merge — the
 * draft has no way to tell them apart without a key, and merging them is the
 * same call the mockup itself makes.
 */
export function groupExperienceByEmployer(
  experience: readonly ResumeExperienceInput[],
): readonly ExperienceEmployerGroup[] {
  const groups: ExperienceEmployerGroup[] = [];
  const indexByKey = new Map<string, number>();
  experience.forEach((entry, order) => {
    const key = entry.employerGroupKey?.trim() || entry.employer?.trim() || `__ungrouped-${order}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      const existing = groups[existingIndex];
      groups[existingIndex] = { ...existing, positions: [...existing.positions, entry] };
      return;
    }
    indexByKey.set(key, groups.length);
    groups.push({
      key,
      employer: entry.employer?.trim() ?? '',
      location: entry.location,
      positions: [entry],
    });
  });
  return groups;
}

export interface SkillCategoryGroup {
  readonly label: string;
  readonly skills: readonly ResumeSkillInput[];
}

const OTHER_CATEGORY = 'Другое';

/**
 * A fixed, deterministic dictionary (B265 §4: "детерминированный словарь
 * категорий, неизвестные → «Другое»") — never an LLM call, so the same skill
 * always lands in the same group and an unrecognised one is visible instead
 * of silently dropped.
 */
const SKILL_CATEGORIES: readonly { label: string; match: readonly string[] }[] = [
  {
    label: 'Управление и стратегия',
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
    match: ['go', 'typescript', 'python', 'postgresql', 'grpc', 'react', 'java', 'javascript', 'sql'],
  },
  {
    label: 'Продукт и комплаенс',
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

function normalized(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Deterministic membership lookup: same skill name always resolves to the
 * same category label, so a skill never silently jumps groups between runs.
 */
function categoryLabelFor(skillName: string): string {
  const key = normalized(skillName);
  const found = SKILL_CATEGORIES.find((category) => category.match.includes(key));
  return found?.label ?? OTHER_CATEGORY;
}

export function categorizeSkills(
  skills: readonly ResumeSkillInput[],
): readonly SkillCategoryGroup[] {
  const order = [...SKILL_CATEGORIES.map((c) => c.label), OTHER_CATEGORY];
  const byLabel = new Map<string, ResumeSkillInput[]>();
  skills.forEach((skill) => {
    const label = categoryLabelFor(skill.name);
    const bucket = byLabel.get(label) ?? [];
    byLabel.set(label, [...bucket, skill]);
  });
  return order
    .filter((label) => (byLabel.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, skills: byLabel.get(label) ?? [] }));
}
