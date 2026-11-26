import type { CoachTurnSubject } from '../../coach/coachApi';

/** Параметры адреса открытого экрана. */
export type ScreenParams = Readonly<Record<string, string | undefined>>;

/** «Ближайшее интервью»: отклик ещё не выбран, объекта нет. */
const NEXT_RESPONSE = 'next';
/** Письмо к вакансии без отклика открывается по id вакансии из подборки. */
const VACANCY_PREFIX = 'cluster-';

/**
 * B746: над чем открыта панель консультанта. Отклик и его шаги (письмо, интервью, разбор) —
 * отклик, карточка вакансии — вакансия, карточка компании — компания по ключу адреса
 * (B783). Сервер строит контекст только по объекту этого кандидата.
 */
export function subjectOfScreen(params: ScreenParams | null): CoachTurnSubject | undefined {
  const response = params?.responseId;
  if (response && response !== NEXT_RESPONSE) {
    return response.startsWith(VACANCY_PREFIX)
      ? { kind: 'vacancy', id: response }
      : { kind: 'application', id: response };
  }
  if (params?.vacancyId) return { kind: 'vacancy', id: params.vacancyId };
  return params?.companyId ? { kind: 'company', id: params.companyId } : undefined;
}
