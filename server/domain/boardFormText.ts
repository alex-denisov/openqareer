import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import { clip } from './questionText';

/** Вопрос, на который можно ответить текстом; обязательный другого вида; необязательный другого вида. */
export type ParsedQuestion = QuestionnaireQuestion | 'required_unknown' | null;

const MAX_OPTIONS = 300;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]{2,6}));/giu,
    (all, dec, hex, name) => {
      const code = dec ? Number(dec) : hex ? Number.parseInt(hex, 16) : 0;
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      return Object.hasOwn(ENTITIES, name ?? '') ? ENTITIES[name] : all;
    },
  );
}

export const plain = (html: string, max: number): string =>
  clip(decode(html.replace(/<[^<>]*>/gu, ' ')), max);

export function withChoice(
  base: Pick<QuestionnaireQuestion, 'id' | 'text' | 'required'>,
  labels: readonly string[],
  multiple: boolean,
): QuestionnaireQuestion | null {
  const options = [...new Set(labels.filter(Boolean))].slice(0, MAX_OPTIONS);
  if (options.length === 0) return null;
  return { ...base, kind: 'choice', options, ...(multiple ? { multiple: true } : {}) };
}
