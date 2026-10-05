import type { ResumeDraft } from '../domain/resumeDraft';

export interface DraftFact {
  readonly ref: string;
  readonly statement: string;
}

interface DraftFactSource {
  readonly memory: readonly {
    readonly id: string;
    readonly status: string;
    readonly statement: string;
  }[];
  readonly resume:
    | { readonly draft: Pick<ResumeDraft, 'targetRole' | 'experience' | 'skills'> }
    | null
    | undefined;
}

const MAX_FACTS = 7;
const MAX_EXPERIENCE = 4;
const MAX_SKILLS = 8;

function resumeFacts(
  draft: Pick<ResumeDraft, 'targetRole' | 'experience' | 'skills'>,
): DraftFact[] {
  const role = draft.targetRole?.trim()
    ? [{ ref: 'resume:targetRole', statement: `Целевая роль: ${draft.targetRole.trim()}` }]
    : [];
  const experience = draft.experience
    .filter((item) => item.title?.trim() && item.employer?.trim())
    .slice(0, MAX_EXPERIENCE)
    .map((item) => {
      const period = item.startDate
        ? ` (${item.startDate} — ${item.current ? 'по настоящее время' : (item.endDate ?? '…')})`
        : '';
      return {
        ref: `resume:experience:${item.id}`,
        statement: `${item.title!.trim()} — ${item.employer!.trim()}${period}`,
      };
    });
  const skills = (draft.skills ?? [])
    .map((skill) => skill.name.trim())
    .filter(Boolean)
    .slice(0, MAX_SKILLS);
  const skillFact = skills.length
    ? [{ ref: 'resume:skills', statement: `Навыки: ${skills.join(', ')}` }]
    : [];
  return [...role, ...experience, ...skillFact];
}

/**
 * Факты для черновика LinkedIn: сначала подтверждённые кандидатом, затем данные его резюме
 * (B372: у кандидата с подключённым LinkedIn память почти пуста, а опыт лежит в резюме).
 */
export function collectDraftFacts(source: DraftFactSource): readonly DraftFact[] {
  const confirmed = source.memory
    .filter((fact) => fact.status === 'confirmed' || fact.status === 'corrected')
    .map((fact) => ({ ref: fact.id, statement: fact.statement }));
  const fromResume = source.resume?.draft ? resumeFacts(source.resume.draft) : [];
  return [...confirmed, ...fromResume].slice(0, MAX_FACTS);
}
