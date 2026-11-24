import type { ResumeDraft } from '../../resume/resumeTypes';

/** Потолок названия навыка, как у `labelSchema` профиля на сервере. */
export const SKILL_NAME_MAX = 300;

const fold = (value: string): string => value.trim().toLocaleLowerCase('ru-RU');

/** Профиль с новым навыком; пустое имя и повтор ничего не меняют. */
export function withSkill(draft: ResumeDraft, rawName: string, id: string): ResumeDraft {
  const name = rawName.trim().replace(/\s+/gu, ' ').slice(0, SKILL_NAME_MAX);
  const skills = draft.skills ?? [];
  if (!name || skills.some((skill) => fold(skill.name) === fold(name))) return draft;
  return { ...draft, skills: [...skills, { id, name }] };
}
