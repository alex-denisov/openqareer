import {
  VACANCY_TRIAGE_MAX_IDS,
  type VacancyTriage,
  type VacancyTriageQuestionId,
  type VacancyTriageRow,
} from '../../../../../shared/b640Vacancies';
import type { SkipReasonId } from '../../../../../shared/skipReasons';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';

export const TRIAGE_MAX_IDS = VACANCY_TRIAGE_MAX_IDS;

/** Вакансия к скрытию и причина, с которой её скрывают. */
export interface HideEntry {
  readonly id: string;
  readonly reason: SkipReasonId;
  /** Строка списка, если клиент её уже дочитал: по ней вакансия сразу видна в «скрытых». */
  readonly item?: MatchedVacancyItem;
}

export interface CurrentQuestion {
  readonly id: VacancyTriageQuestionId;
  readonly text: string;
  /** «k» из «k из N»: сколько вопросов уже закрыто, плюс этот. */
  readonly number: number;
  readonly total: number;
}

/** Вакансии на разбор: весь список кандидата в его порядке, без повторов, не больше 1000. */
export function triageIds(items: ReadonlyArray<{ readonly cluster: { readonly id: string } }>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const { cluster } of items) {
    if (ids.length >= TRIAGE_MAX_IDS) break;
    if (seen.has(cluster.id)) continue;
    seen.add(cluster.id);
    ids.push(cluster.id);
  }
  return ids;
}

export function triageRowMap(triage: VacancyTriage | null): ReadonlyMap<string, VacancyTriageRow> {
  return new Map((triage?.rows ?? []).map((row) => [row.clusterId, row]));
}

/** Строки к скрытию: вердикт hide, флажок не снят, вакансия ещё в списке. */
export function pickedIds(
  triage: VacancyTriage | null,
  unchecked: ReadonlySet<string>,
  gone: ReadonlySet<string> = new Set(),
): string[] {
  return (triage?.rows ?? [])
    .filter((row) => row.verdict === 'hide' && !unchecked.has(row.clusterId) && !gone.has(row.clusterId))
    .map((row) => row.clusterId);
}

export function toggleUnchecked(unchecked: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(unchecked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Подборка слабо совпадает, когда подходящих меньше половины. */
export function isWeakMatch(summary: VacancyTriage['summary']): boolean {
  return summary.total > 0 && summary.keep * 2 < summary.total;
}

/** Первый вопрос без ответа; номер считается по числу уже закрытых. */
export function currentQuestion(triage: VacancyTriage | null): CurrentQuestion | null {
  const first = triage?.questions[0];
  if (!triage || !first) return null;
  return {
    id: first.id,
    text: first.text,
    number: triage.questionTotal - triage.questions.length + 1,
    total: triage.questionTotal,
  };
}
