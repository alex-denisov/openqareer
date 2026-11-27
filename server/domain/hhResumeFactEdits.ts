import type { HhResumeSections } from '../../shared/hhCandidateSession';
import { languageOf, type HhEditDraft } from './hhResumeEdits';

/**
 * B787: правка «исправить факт». Если в резюме hh.ru у показателя (рентабельность, маржа)
 * стоит один процент, а подтверждённый факт профиля называет другой, платформа предлагает
 * исправить число в тексте резюме. Остальной текст не трогаем; применяется только к копии.
 */
/** Рентабельность и маржа — один показатель: кандидат и консультант называют его по-разному. */
const MEASURES: ReadonlyArray<RegExp> = [
  /рентабельн\p{L}*|profitab\p{L}*|марж\p{L}*|margin\p{L}*/iu,
];
/** «с 16% до 40%»: показатель сейчас — второе число, первое было раньше. */
const RANGE_START = /(?:^|[^\p{L}])(?:с|from)\s*$/iu;
/** Показатель и число рядом: «рентабельность 80 %», «маржа до 40%», «margin of 40%». */
const NEAR = 40;
const PERCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s?%/gu;

interface Mention {
  /** -1 — рядом нет слова показателя: такое число узнаётся только по началу диапазона. */
  readonly measure: number;
  readonly value: string;
  /** «с 16% до 40%»: начало диапазона — у одного показателя оно одно и то же. */
  readonly from?: string;
  readonly start: number;
  readonly end: number;
}

const RANGE_END = /(?:^|[^\p{L}])(?:до|to)\s*$/iu;
/** Конец диапазона стоит сразу за началом: «с 16% до 40%». */
const RANGE_GAP = 12;

function mentions(text: string): Mention[] {
  const found = [...text.matchAll(PERCENT)];
  return found.flatMap((match, index) => {
    const start = match.index ?? 0;
    if (RANGE_START.test(text.slice(Math.max(0, start - 6), start))) return [];
    const previous = found[index - 1];
    const previousStart = previous?.index ?? 0;
    const ranged =
      previous !== undefined &&
      RANGE_START.test(text.slice(Math.max(0, previousStart - 6), previousStart)) &&
      start - (previousStart + previous[0].length) <= RANGE_GAP &&
      RANGE_END.test(text.slice(Math.max(0, start - 5), start));
    const from = ranged ? previous[1]! : undefined;
    const measure = MEASURES.findIndex((pattern) =>
      pattern.test(text.slice(Math.max(0, start - NEAR), start)),
    );
    if (measure < 0 && from === undefined) return [];
    return [
      {
        measure,
        value: match[1]!,
        ...(from === undefined ? {} : { from }),
        start,
        end: start + match[0].length,
      },
    ];
  });
}

const same = (a: string, b: string) => Number(a.replace(',', '.')) === Number(b.replace(',', '.'));

/** Тот же показатель: одно начало диапазона или одно слово показателя. */
function sameMeasure(fact: Mention, item: Mention, byRange: boolean): boolean {
  if (byRange)
    return fact.from !== undefined && item.from !== undefined && same(fact.from, item.from);
  return item.measure >= 0 && fact.measure === item.measure;
}

/**
 * Значение показателя по профилю: факты идут от новых к старым, последнее подтверждённое число и верно.
 * Диапазон сначала сверяется по началу («с 16%»): так узнаётся и факт без слова показателя.
 */
function confirmedValue(facts: readonly string[], item: Mention): string | null {
  const passes = item.from === undefined ? [false] : [true, false];
  for (const byRange of passes) {
    for (const fact of facts) {
      const found = mentions(fact).find((candidate) => sameMeasure(candidate, item, byRange));
      if (found) return found.value;
    }
  }
  return null;
}

export function correctedText(text: string, facts: readonly string[]): string {
  return mentions(text)
    .reverse()
    .reduce((current, item) => {
      const value = confirmedValue(facts, item);
      if (value === null || same(value, item.value)) return current;
      return `${current.slice(0, item.start)}${value} %${current.slice(item.end)}`;
    }, text);
}

/** Места и «о себе», у которых нет своей правки, но есть расхождение с фактом профиля. */
export function factEdits(
  sections: HhResumeSections,
  facts: readonly string[],
  covered: ReadonlySet<string>,
): HhEditDraft[] {
  const places = sections.places.flatMap((place, index) => {
    const id = `experience:${index}`;
    const now = correctedText(place.text, facts);
    if (covered.has(id) || now === place.text) return [];
    return [
      {
        id: `fact:${id}`,
        section: 'experience' as const,
        place: [place.employer, place.period].filter(Boolean).join(' · '),
        employer: place.employer,
        position: place.title,
        was: place.text,
        now,
        language: languageOf(now),
      },
    ];
  });
  const about = sections.about ?? '';
  const aboutNow = correctedText(about, facts);
  const aboutEdit: HhEditDraft[] =
    covered.has('about') || sections.aboutRead !== true || aboutNow === about
      ? []
      : [
          {
            id: 'fact:about',
            section: 'about',
            was: about,
            now: aboutNow,
            language: languageOf(aboutNow),
          },
        ];
  return [...places, ...aboutEdit];
}
