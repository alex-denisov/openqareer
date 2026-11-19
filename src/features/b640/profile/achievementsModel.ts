import { displayYear } from '../../resume/experienceDate';
import type {
  ResumeAchievementInput,
  ResumeAchievementKind,
  ResumeDraft,
} from '../../resume/resumeTypes';
import type { RecordRow } from './profileModel';

/** Группа записей раздела: подзаголовок `h3.psec-sub` и строки. */
export interface AchievementGroup {
  readonly sub: string;
  readonly rows: readonly RecordRow[];
}

export interface AchievementGroups {
  /** «Награды и публикации». */
  readonly awards: readonly AchievementGroup[];
  /** «Организации и волонтёрство». */
  readonly orgs: readonly AchievementGroup[];
}

const LABEL: Readonly<Record<ResumeAchievementKind, string>> = {
  honor: 'Награды',
  publication: 'Публикации и выступления',
  patent: 'Патенты',
  organization: 'Организации',
  volunteering: 'Волонтёрство',
};

const AWARD_KINDS: readonly ResumeAchievementKind[] = ['honor', 'publication', 'patent'];
const ORG_KINDS: readonly ResumeAchievementKind[] = ['organization', 'volunteering'];
/** Виды, которые макет предлагает строкой «Ещё можно добавить». */
const OFFERED_KINDS: readonly ResumeAchievementKind[] = ['patent', 'volunteering'];

function row(item: ResumeAchievementInput): RecordRow | null {
  const title = item.title?.trim();
  if (!title) return null;
  const year = item.date ? displayYear(item.date) : '';
  const sub = [item.issuer ?? item.role, year]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');
  return { id: item.id, title, sub };
}

function rowsOf(draft: ResumeDraft, kind: ResumeAchievementKind): readonly RecordRow[] {
  return (draft.achievements ?? [])
    .filter((item) => item.kind === kind)
    .map(row)
    .filter((item): item is RecordRow => item !== null);
}

function groups(draft: ResumeDraft, kinds: readonly ResumeAchievementKind[]): AchievementGroup[] {
  return kinds
    .map((kind) => ({ sub: LABEL[kind], rows: rowsOf(draft, kind) }))
    .filter((group) => group.rows.length > 0);
}

/** Разделы «Награды и публикации» и «Организации и волонтёрство» по видам записей. */
export function achievementGroups(draft: ResumeDraft): AchievementGroups {
  return { awards: groups(draft, AWARD_KINDS), orgs: groups(draft, ORG_KINDS) };
}

/** «Ещё можно добавить: Патенты, Волонтёрство» — виды, которых в профиле нет. */
export function missingAchievementKinds(draft: ResumeDraft): readonly string[] {
  return OFFERED_KINDS.filter((kind) => rowsOf(draft, kind).length === 0).map(
    (kind) => LABEL[kind],
  );
}
