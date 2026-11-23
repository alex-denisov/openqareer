/**
 * B640, 10.11 (решение CPO): пустых писем быть не должно. Если проверка отклонила письмо, а следующей
 * ступени нет (Gemini без бонуса Vertex), та же модель пишет ещё раз, и запрос называет причину отказа
 * одной фразой на правило. Утверждённый запрос не меняется: фраза идёт отдельным абзацем в конце.
 */
const RULE_TEXT: Readonly<Record<string, string>> = {
  number: 'Не пиши цифр, которых нет в профиле кандидата: каждая цифра письма должна стоять в профиле.',
  name: 'Не переводи и не меняй названия работодателей и компаний, пиши их так, как они стоят в профиле, и не называй других имён людей, кроме имени кандидата в подписи.',
  cyrillic: 'Письмо на английском: не оставляй в нём кириллицы.',
  distorted: 'Пиши слова из профиля и вакансии без опечаток: проверь заглавные буквы и окончания.',
  /** B753: проверка сообщения знакомому и рекрутёру (`modelMessageRejection`). */
  contact_too_long: 'Сообщение вышло длинным: напиши короче — 3–4 коротких предложения, не длиннее 400 знаков.',
  contact_response_formula: 'Это сообщение знакомому, не отклик работодателю: без «Откликаюсь», «Прошу рассмотреть» и похожих слов.',
  contact_new_digits: 'Не пиши цифр, которых нет в профиле кандидата.',
  contact_empty: 'Напиши само сообщение.',
  contact_english_role: 'Целевые роли называй по-русски, как в запросе; прежние должности — как в профиле.',
  contact_mentions_vacancy: 'Вакансии в запросе нет: не упоминай вакансию, повод — компания получателя и целевая роль.',
  contact_distorted: 'Пиши слова без искажений: проверь заглавные буквы и окончания.',
};

const RESUME_TEXT = {
  attached: 'Последней фразой перед подписью скажи, что резюме приложено.',
  absent: 'Не упоминай резюме: к этому отклику его не прикладывают.',
} as const;

const GATE_PREFIX = 'letter_gate:';

/** Правила из `letter_gate:name,number`; пусто, если отказ не от проверки. */
export function gateRules(detail: string | undefined): string[] {
  if (!detail?.startsWith(GATE_PREFIX)) return [];
  return detail.slice(GATE_PREFIX.length).split(',').filter(Boolean);
}

/** Одна фраза на нарушенное правило; незнакомое правило не даёт фразы. */
export function letterCorrection(rules: readonly string[], resumeAttached = true): string | undefined {
  const phrases = [...new Set(rules)].flatMap((rule) => {
    if (rule === 'resume') return [resumeAttached ? RESUME_TEXT.attached : RESUME_TEXT.absent];
    const text = RULE_TEXT[rule];
    return text ? [text] : [];
  });
  return phrases.length > 0 ? `Прошлый вариант письма отклонён. ${phrases.join(' ')}` : undefined;
}
