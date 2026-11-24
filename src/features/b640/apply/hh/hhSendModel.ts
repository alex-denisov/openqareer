import type { HhApplyOutcome, HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';

/** Что показывает шаг после попытки отклика: результат на месте, без перехода. */
export type HhSendResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'questionnaire' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'error'; readonly text: string };

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  captcha: 'hh.ru просит пройти проверку. Пройдите её в окне hh.ru и отправьте снова.',
  already_applied: 'На эту вакансию вы уже откликались на hh.ru.',
  resume_not_found: 'Этого резюме нет в отклике на hh.ru. Выберите другое.',
  no_confirmation: 'hh.ru не подтвердил отклик. Проверьте его на hh.ru.',
  no_response_button: 'На странице вакансии нет кнопки отклика: возможно, вакансию закрыли.',
  popup_missing: 'hh.ru не открыл окно отклика. Повторите.',
  hh_daily_limit_reached: 'На сегодня отклики через hh.ru закончились. Завтра можно продолжить.',
  hh_already_applied: 'Вы уже откликнулись на эту вакансию через hh.ru.',
  hh_apply_in_progress: 'Отклик на эту вакансию уже отправляется.',
  hh_cooldown: 'hh.ru просил проверку. Следующий отклик через hh.ru — через час.',
  apply_running: 'Другой отклик через hh.ru ещё отправляется.',
};

const DEFAULT_FAILURE = 'Отклик не отправлен. Повторите.';

/** Исход отклика из окна hh.ru — в состояние шага. */
export function resultOf(outcome: HhApplyOutcome, failureCode?: string | null): HhSendResult {
  if (outcome === 'sent') return { kind: 'sent' };
  if (outcome === 'questionnaire') return { kind: 'questionnaire' };
  if (failureCode === 'not_signed_in' || failureCode === 'session_window_missing') return { kind: 'signin' };
  return { kind: 'error', text: (failureCode && FAILURE_TEXT[failureCode]) || DEFAULT_FAILURE };
}

const plainTitle = (title: string) => title.replace(/\s+/gu, ' ').trim();

/** Заголовок выбранного резюме, если в списке кандидата он один; иначе по нему резюме не узнать. */
export function uniqueResumeTitle(snapshot: HhResumeSnapshot | null): string | undefined {
  const selected = snapshot?.selected;
  if (!snapshot || !selected) return undefined;
  const listed = snapshot.resumes.find((item) => item.id === selected.id);
  const title = plainTitle(listed?.title ?? '');
  const same = snapshot.resumes.filter((item) => plainTitle(item.title) === title);
  return title && same.length === 1 && !/\p{Cc}/u.test(title) ? title : undefined;
}

/** Отказ сервера до отклика: код ошибки — в те же слова. */
export function refusalText(code: string | undefined): string {
  return (code && FAILURE_TEXT[code]) || DEFAULT_FAILURE;
}

/** «0:42» — сколько ждём ответа hh.ru. */
export function elapsedLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** Код сбоя окна приложения: «session_window_missing: …» → «session_window_missing». */
export function desktopFailureCode(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  const code = raw.split(':')[0]!.trim();
  return /^[a-z0-9_]{1,64}$/u.test(code) ? code : 'desktop_failed';
}
