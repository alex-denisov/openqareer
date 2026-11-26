/**
 * B635: что вакансия просит — задача, требование или строка описания её словами. По ним строятся
 * вопросы подготовки. Текст входит в id вопроса: ответ кандидата остаётся со своим вопросом, даже
 * когда вакансия ушла из пула или её описание прочитали полнее.
 */
export type InterviewAskKind = 'duty' | 'req' | 'text';

export interface InterviewAsk {
  readonly kind: InterviewAskKind;
  readonly text: string;
}

export interface InterviewAskQuestion {
  readonly id: string;
  readonly question: string;
}

/** Вместе с видом укладывается в предел id вопроса (120 знаков в `starPrepValidation`). */
export const INTERVIEW_ASK_MAX_CHARS = 110;

const ID = /^(duty|req|text):(.+)$/su;

const QUESTION: Readonly<Record<InterviewAskKind, (quote: string) => string>> = {
  duty: (quote) =>
    `В задачах роли — ${quote}. Расскажите о похожей задаче: что сделали вы и чем она закончилась?`,
  req: (quote) => `В требованиях — ${quote}. На каком примере вы покажете этот опыт?`,
  text: (quote) => `В описании вакансии — ${quote}. Какой ваш опыт ближе всего к этому?`,
};

const COUNTER: Readonly<Record<InterviewAskKind, (quote: string) => string>> = {
  duty: (quote) => `В задачах роли — ${quote}. Какой результат здесь ждут в первые месяцы?`,
  req: (quote) => `В требованиях — ${quote}. В каких задачах это понадобится в первую очередь?`,
  text: (quote) => `В описании вакансии — ${quote}. Что в этом сейчас главное для команды?`,
};

const quoted = (text: string) => `«${text.replace(/[«»"“”]/gu, '')}»`;

export function askQuestion(ask: InterviewAsk): InterviewAskQuestion {
  return { id: `${ask.kind}:${ask.text}`, question: QUESTION[ask.kind](quoted(ask.text)) };
}

export function askCounterQuestion(ask: InterviewAsk): string {
  return COUNTER[ask.kind](quoted(ask.text));
}

/** Вопрос по сохранённому id; `null` — id не из описания вакансии. */
export function askQuestionOfId(id: string): InterviewAskQuestion | null {
  const match = ID.exec(id);
  return match ? askQuestion({ kind: match[1] as InterviewAskKind, text: match[2]! }) : null;
}
