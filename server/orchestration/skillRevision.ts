import { randomUUID } from 'node:crypto';
import type { ResumeDraft } from '../domain/resumeDraft';

type DraftSkill = NonNullable<ResumeDraft['skills']>[number];

/** Canonical, comparable state of one profile skill; 'null' means "no such skill". */
export interface SkillState {
  readonly name: string;
  readonly level?: string;
  readonly status?: string;
  readonly source?: string;
  readonly verifiedAt?: string;
}

export const ABSENT_SKILL = 'null';

export function skillKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 70);
  return key || 'skill';
}

function findSkill(draft: ResumeDraft, key: string): DraftSkill | undefined {
  return (draft.skills ?? []).find((skill) => skillKey(skill.name) === key);
}

export function serializeSkillState(skill: SkillState | undefined): string {
  if (!skill) return ABSENT_SKILL;
  return JSON.stringify({
    name: skill.name,
    level: skill.level,
    status: skill.status,
    source: skill.source,
    verifiedAt: skill.verifiedAt,
  });
}

export function currentSkillText(draft: ResumeDraft, key: string): string {
  return serializeSkillState(findSkill(draft, key));
}

/** Writes the given serialized state into the draft; 'null' removes the skill. */
export function writeSkillState(draft: ResumeDraft, key: string, text: string): ResumeDraft {
  const skills = draft.skills ?? [];
  const existing = findSkill(draft, key);
  if (text === ABSENT_SKILL) {
    return { ...draft, skills: skills.filter((skill) => skill !== existing) };
  }
  const state = JSON.parse(text) as SkillState;
  const next: DraftSkill = {
    id: existing?.id ?? `skill-${randomUUID().slice(0, 8)}`,
    ...(existing?.evidenceMemoryId ? { evidenceMemoryId: existing.evidenceMemoryId } : {}),
    name: state.name,
    ...(state.level ? { level: state.level } : {}),
    ...(state.status ? { status: state.status } : {}),
    ...(state.source ? { source: state.source } : {}),
    ...(state.verifiedAt ? { verifiedAt: state.verifiedAt } : {}),
  };
  return {
    ...draft,
    skills: existing
      ? skills.map((skill) => (skill === existing ? next : skill))
      : [...skills, next],
  };
}

/** State after a quiz: keeps the candidate's level, replaces status, source and date. */
export function skillStateAfterQuiz(
  draft: ResumeDraft,
  skillName: string,
  fact: { readonly status: string; readonly source: string; readonly date: string },
): SkillState {
  const existing = findSkill(draft, skillKey(skillName));
  return {
    name: existing?.name ?? skillName,
    level: existing?.level,
    status: fact.status,
    source: fact.source,
    verifiedAt: fact.date,
  };
}
