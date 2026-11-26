import type { CandidateStatusId } from './candidateStatus';

/**
 * B691: сигналы на «Сегодня» — «похоже, вы начали искать работу» и «хотите
 * сменить профессию». Сигнал только спрашивает: статус меняет сам кандидат.
 */
export const STATUS_SIGNAL_KINDS = ['started_search', 'changing_profession'] as const;
export type StatusSignalKind = (typeof STATUS_SIGNAL_KINDS)[number];

export const STATUS_SIGNAL_ANSWERS = ['yes', 'no', 'later'] as const;
export type StatusSignalAnswer = (typeof STATUS_SIGNAL_ANSWERS)[number];

/** Вопрос тремя частями: середина выделена на экране. */
export interface StatusSignalQuestion {
  readonly before: string;
  readonly accent: string;
  readonly after: string;
}

export interface StatusSignal {
  readonly kind: StatusSignalKind;
  readonly question: StatusSignalQuestion;
  /** «Почему мы так думаем»: факты из откликов и сохранённых вакансий, не больше трёх. */
  readonly facts: readonly string[];
  /** Что предложить в выборе статуса после «Верно». */
  readonly suggest: {
    readonly status: CandidateStatusId;
    readonly targetProfession: string | null;
  };
}

/** Последний ответ, пока его можно отменить: до конца дня кандидата. */
export interface StatusSignalAnswered {
  readonly id: string;
  readonly kind: StatusSignalKind;
  readonly answer: StatusSignalAnswer;
  readonly undoUntil: string;
}

export interface StatusSignalState {
  readonly signal: StatusSignal | null;
  readonly answered: StatusSignalAnswered | null;
}
