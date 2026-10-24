import {
  SKILL_CATEGORIES,
  OTHER_SKILL_CATEGORY,
  skillCategoryForLabel,
} from '../../../shared/skillLabelClassification';
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

export function categorizeSkills(
  skills: readonly ResumeSkillInput[],
): readonly SkillCategoryGroup[] {
  const order = [...SKILL_CATEGORIES.map((c) => c.label), OTHER_SKILL_CATEGORY];
  const byLabel = new Map<string, ResumeSkillInput[]>();
  skills.forEach((skill) => {
    const label = skillCategoryForLabel(skill.name)?.label ?? OTHER_SKILL_CATEGORY;
    const bucket = byLabel.get(label) ?? [];
    byLabel.set(label, [...bucket, skill]);
  });
  return order
    .filter((label) => (byLabel.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, skills: byLabel.get(label) ?? [] }));
}
