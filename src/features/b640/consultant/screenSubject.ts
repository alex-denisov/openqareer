import type { CoachTurnSubject } from '../../coach/coachApi';

/** Параметры адреса открытого экрана. */
export type ScreenParams = Readonly<Record<string, string | undefined>>;

/** «Ближайшее интервью»: отклик ещё не выбран, объекта нет. */
const NEXT_RESPONSE = 'next';
/** Письмо к вакансии без отклика открывается по id вакансии из подборки. */
const VACANCY_PREFIX = 'cluster-';

/**
 * B746: над чем открыта панель консультанта. Отклик и его шаги (письмо, интервью, разбор) —
 * отклик, карточка вакансии — вакансия. Компанию не передаём: ключ адреса карточки
 * не совпадает с ключом компании у консультанта. Сервер строит контекст только по
 * объекту этого кандидата.
 */
export function subjectOfScreen(params: ScreenParams | null): CoachTurnSubject | undefined {
  const response = params?.responseId;
  if (response && response !== NEXT_RESPONSE) {
    return response.startsWith(VACANCY_PREFIX)
      ? { kind: 'vacancy', id: response }
      : { kind: 'application', id: response };
  }
  return params?.vacancyId ? { kind: 'vacancy', id: params.vacancyId } : undefined;
}
