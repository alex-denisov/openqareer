import type { CandidateDecisionProfile } from '../../../../shared/workPreferences';
import {
  addCandidateStopCompany,
  listCandidateStopCompanies,
  removeCandidateStopCompany,
} from '../../automation/automationApi';
import {
  decisionProfileToSearchConditions,
  searchConditionsToDecisionProfile,
} from '../../career-map/careerConditionsStorage';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';
import { getDecisionProfile, putDecisionProfile } from '../../coach/coachApi';

export interface ConditionsData {
  readonly conditions: SearchConditionsDraft;
  /** Профиль ограничений как на сервере: поля вне условий сохраняются нетронутыми. */
  readonly profile: CandidateDecisionProfile | null;
}

export async function loadConditions(signal: AbortSignal): Promise<ConditionsData> {
  const [profile, stop] = await Promise.all([
    getDecisionProfile(signal),
    listCandidateStopCompanies(),
  ]);
  const stopList = stop.map((row) => ({ id: row.company, name: row.company, origin: row.origin }));
  return { profile, conditions: decisionProfileToSearchConditions(profile, stopList) };
}

const names = (draft: SearchConditionsDraft): readonly string[] =>
  draft.stopList.map((company) => company.name);

/** Стоп-лист сверяется с сервером, а не с прошлым экраном: повтор после сбоя ничего не дублирует. */
async function saveStopList(
  before: SearchConditionsDraft,
  after: SearchConditionsDraft,
): Promise<void> {
  const target = names(after);
  if (JSON.stringify(names(before)) === JSON.stringify(target)) return;
  const current = (await listCandidateStopCompanies()).map((row) => row.company);
  const key = (name: string) => name.trim().toLocaleLowerCase('ru');
  const has = (list: readonly string[], name: string) => list.some((x) => key(x) === key(name));
  for (const name of target) if (!has(current, name)) await addCandidateStopCompany(name);
  for (const name of current) if (!has(target, name)) await removeCandidateStopCompany(name);
}

const sameProfilePart = (a: SearchConditionsDraft, b: SearchConditionsDraft): boolean =>
  JSON.stringify([a.geography, a.salaryFrom.amountRubles, a.salaryFrom.showWithoutSalary, a.format]) ===
  JSON.stringify([b.geography, b.salaryFrom.amountRubles, b.salaryFrom.showWithoutSalary, b.format]);

/** Сохраняет переход `before → after`: профиль ограничений и стоп-лист — только изменённое. */
export async function saveConditions(
  data: ConditionsData,
  after: SearchConditionsDraft,
): Promise<ConditionsData> {
  let profile = data.profile;
  if (!sameProfilePart(data.conditions, after)) {
    const next = searchConditionsToDecisionProfile(after, data.profile);
    await putDecisionProfile(next);
    profile = next;
  }
  await saveStopList(data.conditions, after);
  return { profile, conditions: after };
}
