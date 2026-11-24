import { HH_WINDOW_LEFT_OPEN_FAILURES, hhApplyStep } from '../../../../../shared/hhCandidateSession';
import type { HhApplyOutcome, HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';

/** Что показывает шаг после попытки отклика: результат на месте, без перехода. */
export type HhSendResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'questionnaire' }
  | { readonly kind: 'signin' }
  /** hh.ru просит анкету до отклика: отклик не ушёл. */
  | { readonly kind: 'form' }
  /** hh.ru уже держит отклик на эту вакансию. */
  | { readonly kind: 'already' }
  /** hh.ru спрашивает кандидата до отклика: ответ даётся на нашем экране. */
  | { readonly kind: 'question'; readonly about: HhSendQuestion }
  | {
      readonly kind: 'error';
      readonly text: string;
      /** hh.ru ждёт кандидата в своём окне. */
      readonly inWindow?: boolean;
      readonly captcha?: boolean;
    };

export type HhSendQuestion = 'consent' | 'relocation' | 'visibility';

/** Вопрос hh.ru словами кандидата и ответ «да». */
export const QUESTION_TEXT: Readonly<Record<HhSendQuestion, { readonly text: string; readonly yes: string }>> = {
  relocation: { text: 'Вакансия в другой стране или городе. Всё равно откликнуться?', yes: 'Откликнуться' },
  visibility: {
    text: 'hh.ru покажет ваше резюме работодателям из другой страны. Разрешить и откликнуться?',
    yes: 'Разрешить',
  },
  consent: { text: 'Работодатель просит согласие на обработку персональных данных. Согласиться и откликнуться?', yes: 'Согласиться' },
};

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  captcha: 'hh.ru просит пройти проверку. Пройдите её в окне hh.ru и отправьте снова.',
  resume_not_found: 'Этого резюме нет в отклике на hh.ru. Выберите другое.',
  no_confirmation: 'hh.ru не подтвердил отклик. Проверьте его на hh.ru.',
  no_response_button: 'Страница вакансии на hh.ru не догрузилась, отклик не отправлен. Повторите.',
  vacancy_closed: 'Вакансия снята с hh.ru, отклик не отправлен.',
  hh_error: 'hh.ru не принял отклик.',
  answers_not_kept: 'hh.ru не сохранил ответы анкеты, отклик не отправлен. Повторите.',
  popup_missing: 'hh.ru не открыл окно отклика. Повторите.',
  hh_vacancy_mismatch: 'На hh.ru по этому адресу другая вакансия. Отклик не отправлен.',
  hh_daily_limit_reached: 'На сегодня отклики через hh.ru закончились. Завтра можно продолжить.',
  hh_apply_in_progress: 'Отклик на эту вакансию уже отправляется.',
  hh_cooldown: 'hh.ru просил проверку. Следующий отклик через hh.ru — через час.',
  session_window_missing: 'Окно hh.ru закрылось, отклик не отправлен. Повторите.',
  hh_window_not_opened: 'Окно hh.ru не открылось, отклик не отправлен. Повторите.',
  hh_window_not_loaded: 'hh.ru не загрузился, отклик не отправлен. Повторите.',
  apply_running: 'Другой отклик через hh.ru ещё отправляется.',
};

const LEFT_OPEN: ReadonlySet<string> = new Set(HH_WINDOW_LEFT_OPEN_FAILURES);
const DEFAULT_FAILURE = 'Отклик не отправлен. Повторите.';

/** Исход отклика из окна hh.ru — в состояние шага. */
export function resultOf(outcome: HhApplyOutcome, failureCode?: string | null): HhSendResult {
  if (outcome === 'sent') return { kind: 'sent' };
  if (outcome === 'questionnaire') return { kind: 'questionnaire' };
  if (failureCode === 'already_applied') return { kind: 'already' };
  const step = hhApplyStep(failureCode);
  if (step === 'login') return { kind: 'signin' };
  if (step === 'questionnaire') return { kind: 'form' };
  if (step === 'consent' || step === 'relocation' || step === 'visibility') return { kind: 'question', about: step };
  const inWindow = LEFT_OPEN.has(failureCode ?? '');
  return {
    kind: 'error',
    text: (failureCode && FAILURE_TEXT[failureCode]) || DEFAULT_FAILURE,
    ...(inWindow ? { inWindow } : {}),
    ...(step === 'captcha' ? { captcha: true } : {}),
  };
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

/** Отказ сервера до отклика; уже ушедший отклик — не сбой, а его состояние. */
export function refusalOf(code: string | undefined): HhSendResult {
  return code === 'hh_already_applied' ? { kind: 'already' } : { kind: 'error', text: refusalText(code) };
}

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
