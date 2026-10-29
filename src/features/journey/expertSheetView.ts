import type { ConsultantHistoryMessage } from './consultantHistory';

const QUESTION_LIMIT = 90;

/** Строка беседы в истории: первый вопрос кандидата в одну строку (A2). */
export function historyQuestion(item: { readonly firstPhrase: string }): string {
  const line = item.firstPhrase.replace(/\s+/gu, ' ').trim();
  return line.length > QUESTION_LIMIT ? `${line.slice(0, QUESTION_LIMIT - 1).trimEnd()}…` : line;
}

/** Лист на 390 показывает текущий вопрос и ответ, а не всю ленту с первой реплики (A3). */
export function latestExchange<T extends ConsultantHistoryMessage>(turns: readonly T[]): T[] {
  const lastQuestion = turns.map((turn) => turn.role).lastIndexOf('user');
  return lastQuestion < 0 ? [...turns] : turns.slice(lastQuestion);
}

const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  vacancy: 'эту вакансию',
  application: 'этот отклик',
  company: 'эту компанию',
  interview: 'это интервью',
  adaptation: 'запись дневника',
};

/** «Видит: …» — только то, что действительно уходит с ходом: профиль, условия поиска, объект, рынок. */
export function visibleContextLine(input: {
  readonly subjectKind?: string;
  readonly hasMarketQuery: boolean;
}): string {
  const subject = input.subjectKind ? SUBJECT_LABEL[input.subjectKind] : undefined;
  const parts = subject
    ? ['профиль', subject]
    : ['профиль', 'условия поиска', ...(input.hasMarketQuery ? ['рынок'] : [])];
  return `Видит: ${parts.join(', ')}`;
}
