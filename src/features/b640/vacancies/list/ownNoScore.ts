import type { VacancyFitGateName, VacancyFitView } from '../../../../../shared/vacancyFit';
import { VACANCY_FIT_GATE_NAMES } from '../../../../../shared/vacancyFit';

/** Условие поиска, с которым вакансия не совпала: словами кандидата, без механики расчёта. */
const GATE_TEXT: Readonly<Record<VacancyFitGateName, string>> = {
  role: 'Роль вакансии не входит в ваши условия поиска',
  level: 'Уровень вакансии не входит в ваши условия поиска',
  region: 'Регион вакансии не входит в ваши условия поиска',
  workAuthorization: 'Вакансия требует права на работу, которого нет в профиле',
  workFormat: 'Формат работы не входит в ваши условия поиска',
};

const BUSY: readonly VacancyFitView['state'][] = [
  'not_requested',
  'processing',
  'retrying',
  'refreshing',
];

/**
 * B676 (прод 23.11): без счёта раскрытие своей вакансии всегда говорит почему — в колонке
 * стоит «—», и без строки кандидат не понимает, что не так. Пока считаем — строки нет.
 * Счёт есть только у оценённой вакансии: «0 из 4» при закрытом условии поиска — не счёт.
 */
export function ownNoScoreReason(view: VacancyFitView): string | null {
  if (BUSY.includes(view.state)) return null;
  if (view.state === 'no_requirements') return 'Требования в тексте не нашлись';
  const result = view.result;
  if (view.state === 'failed' || !result) return 'Не удалось посчитать совпадение';
  // Условие поиска не совпало — это и есть ответ, даже когда требования нашлись (B645, прод 23.11).
  const gate = VACANCY_FIT_GATE_NAMES.find((name) => result.gates[name]?.status === 'blocked');
  if (gate) return GATE_TEXT[gate];
  if (result.status === 'assessed' && result.coverage.total > 0) return null;
  if (result.reason === 'no_eligible_facts') return 'Загрузите резюме — посчитаем совпадение.';
  if (result.reason === 'assessment_unavailable') return 'Не удалось посчитать совпадение';
  return 'Мало требований для расчёта';
}
