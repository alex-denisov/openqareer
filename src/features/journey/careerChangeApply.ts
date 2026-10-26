import type {
  CandidateDecisionProfile,
  DecisionWorkFormatId,
} from '../../../shared/workPreferences';
import { addCandidateStopCompany } from '../automation/automationApi';
import { changeRole } from '../career-map/careerRoleStore';
import { getDecisionProfile, putDecisionProfile } from '../coach/coachApi';
import type { CareerChangeKind, CareerChangeView } from '../coach/careerChangeView';

export type { CareerChangeKind } from '../coach/careerChangeView';

/** «Карьера» слушает это событие и перечитывает условия после правки из панели. */
export const CAREER_CONDITIONS_CHANGED = 'openqareer:career-conditions-changed';

const FORMAT_IDS: Readonly<Record<'office' | 'hybrid', DecisionWorkFormatId>> = {
  office: 'office',
  hybrid: 'home_market',
};

export function isCareerChangeKind(kind: string): kind is CareerChangeKind {
  return (
    kind === 'career.role.add' ||
    kind === 'career.role.remove' ||
    kind === 'career.conditions.update'
  );
}

/**
 * Новые условия поверх сохранённых: меняется только то, что назвал кандидат,
 * гражданство, налоги и языки не трогаются. Работа из-за рубежа остаётся,
 * если кандидат не убрал удалёнку целиком.
 */
export function mergeConditions(
  current: CandidateDecisionProfile | null,
  change: CareerChangeView,
): CandidateDecisionProfile {
  const formats = new Set<DecisionWorkFormatId>(current?.workFormats ?? []);
  if (change.formats) {
    for (const id of ['office', 'home_market', 'remote_home'] as const) formats.delete(id);
    if (!change.formats.includes('remote')) formats.delete('remote_abroad');
    for (const format of change.formats) {
      formats.add(
        format === 'remote'
          ? formats.has('remote_abroad')
            ? 'remote_abroad'
            : 'remote_home'
          : FORMAT_IDS[format],
      );
    }
  }
  if (change.relocation === true) formats.add('relocation');
  if (change.relocation === false) formats.delete('relocation');
  const salaryFloor = change.salaryFloorRubles ?? current?.salaryFloor;
  return {
    citizenship: current?.citizenship ?? [],
    searchLocations: change.locations ?? current?.searchLocations ?? [],
    taxStatus: current?.taxStatus ?? '',
    languages: current?.languages ?? [],
    workFormats: [...formats],
    ...(salaryFloor !== undefined ? { salaryFloor } : {}),
    salaryCurrency: change.salaryFloorRubles ? 'RUB' : (current?.salaryCurrency ?? 'RUB'),
    cushionMonths: current?.cushionMonths,
    hasFamily: current?.hasFamily ?? false,
  };
}

/** Что именно поменяется — человеческими словами, до нажатия «Применить». */
export function describeCareerChange(kind: CareerChangeKind, change: CareerChangeView): string[] {
  if (kind !== 'career.conditions.update')
    return change.roleTitle ? [`Роль: ${change.roleTitle}`] : [];
  const formatNames = { office: 'офис', hybrid: 'гибрид', remote: 'удалённо' } as const;
  return [
    change.locations ? `География: ${change.locations.join(', ')}` : null,
    change.salaryFloorRubles
      ? `Зарплата от ${new Intl.NumberFormat('ru-RU').format(change.salaryFloorRubles)} ₽`
      : null,
    change.formats
      ? `Формат: ${change.formats.map((format) => formatNames[format]).join(', ')}`
      : null,
    change.relocation === null
      ? null
      : `Релокация: ${change.relocation ? 'включить' : 'выключить'}`,
    change.stopCompanies ? `Стоп-лист: ${change.stopCompanies.join(', ')}` : null,
  ].filter((line): line is string => line !== null);
}

export async function applyCareerChange(
  kind: CareerChangeKind,
  change: CareerChangeView,
): Promise<void> {
  if (kind !== 'career.conditions.update') {
    if (!change.roleTitle) throw new Error('В предложении нет названия роли.');
    const done = await changeRole(kind === 'career.role.add' ? 'add' : 'remove', change.roleTitle);
    if (!done) throw new Error('Роль не сохранилась. Попробуйте ещё раз.');
    return;
  }
  const changesProfile = [
    change.locations,
    change.salaryFloorRubles,
    change.formats,
    change.relocation,
  ].some((value) => value !== null);
  if (changesProfile) await putDecisionProfile(mergeConditions(await getDecisionProfile(), change));
  for (const company of change.stopCompanies ?? []) await addCandidateStopCompany(company);
  window.dispatchEvent(new Event(CAREER_CONDITIONS_CHANGED));
}

/**
 * Предложение изменить условия опирается на условия в момент ответа. Из
 * сохранённого хода оно не показывается: условия могли уже смениться, и
 * старая карточка («Зарплата от 800 000 ₽» после возврата к 600 000)
 * предлагала бы устаревшее. Роли проверяет `roleChangeAlreadyApplied`.
 */
export function withoutStoredConditionChanges<
  T extends { readonly actionProposals: readonly { readonly kind: string }[] },
>(result: T | undefined): T | undefined {
  if (!result) return undefined;
  return {
    ...result,
    actionProposals: result.actionProposals.filter(
      (proposal) => proposal.kind !== 'career.conditions.update',
    ),
  };
}
