/**
 * Служебные слова контекста в ответе консультанта (B511 Д6).
 *
 * Промпт велит не писать их кандидату, но ответ приходит от любой модели в очереди.
 * Модуль чистый и работает по одному тексту: разметку доказательности заменяет
 * обычными словами, ссылки на записи контекста убирает, имена полей переводит.
 */
const LABEL =
  /(?<![\p{L}\p{N}-])(?:ФАКТ(?:Ы|ОВ|А|У|АМИ)?|ГИПОТЕЗ(?:А|Ы|У|Е|ОЙ)?|НЕИЗВЕСТН[А-ЯЁ]*)(?![\p{L}\p{N}-])/gu;

const REF = String.raw`\x60?(?:memory|star|document|market|consultant-summary):[\w:-]+(?:\.[\w:-]+)*\x60?`;
const BRACKETED_REFS = new RegExp(String.raw`\s*[(\[]\s*${REF}(?:\s*[,;]\s*${REF})*\s*[)\]]`, 'gu');
const BARE_REF = new RegExp(String.raw`\s*${REF}`, 'gu');
const FLAG = /\s*\(?`?(?:source|confirmed)=[a-z]+`?\)?/gu;

const FIELD = String.raw`\x60?(?:knowledgeContext|stageContext|careerContext|resumeContext|confirmedFacts|openQuestions|starStories|otherStoryTitles|marketObservations|priorRoleContributions|consultantHistory|pastMessageMatches|memoryCandidates|evidenceRefs)(?:\.\w+)*\x60?`;
const FIELD_AFTER_PREPOSITION = new RegExp(String.raw`(?<!\p{L})(в|во|из|по)\s+${FIELD}`, 'giu');
const BARE_FIELD = new RegExp(FIELD, 'gu');

const FIELD_FORM: Readonly<Record<string, string>> = {
  в: 'в профиле',
  во: 'в профиле',
  из: 'из профиля',
  по: 'по профилю',
};

function startsSentence(text: string, index: number): boolean {
  return /(?:^|[.!?…]\s+|\n\s*)$/u.test(text.slice(Math.max(0, index - 4), index));
}

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase('ru-RU') + word.slice(1);
}

function plainLabels(text: string): string {
  return text.replace(LABEL, (label, index: number) => {
    const word = label.toLocaleLowerCase('ru-RU');
    return startsSentence(text, index) ? capitalize(word) : word;
  });
}

function plainFields(text: string): string {
  return text
    .replace(FIELD_AFTER_PREPOSITION, (_match, preposition: string) => {
      const form = FIELD_FORM[preposition.toLocaleLowerCase('ru-RU')] ?? 'в профиле';
      return preposition.charAt(0) === preposition.charAt(0).toLocaleLowerCase('ru-RU')
        ? form
        : capitalize(form);
    })
    .replace(BARE_FIELD, 'профиль');
}

export function plainCoachText(text: string): string {
  const withoutRefs = text.replace(BRACKETED_REFS, '').replace(BARE_REF, '').replace(FLAG, '');
  return plainFields(plainLabels(withoutRefs));
}
