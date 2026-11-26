import type { HhResumeSections } from '../../shared/hhCandidateSession';
import { languageOf, type HhEditDraft } from './hhResumeEdits';

/**
 * B787: правка «исправить факт». Если в резюме hh.ru у показателя (рентабельность, маржа)
 * стоит один процент, а подтверждённый факт профиля называет другой, платформа предлагает
 * исправить число в тексте резюме. Остальной текст не трогаем; применяется только к копии.
 */
const MEASURES: ReadonlyArray<RegExp> = [
  /рентабельн\p{L}*|profitab\p{L}*/iu,
  /маржин\p{L}*|марж\p{L}*|margin\p{L}*/iu,
];
/** Показатель и число рядом: «рентабельность 80 %», «маржа до 40%», «margin of 40%». */
const NEAR = 40;
const PERCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s?%/gu;

interface Mention {
  readonly measure: number;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function mentions(text: string): Mention[] {
  return [...text.matchAll(PERCENT)].flatMap((match) => {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - NEAR), start);
    const measure = MEASURES.findIndex((pattern) => pattern.test(before));
    return measure < 0 ? [] : [{ measure, value: match[1]!, start, end: start + match[0].length }];
  });
}

const same = (a: string, b: string) => Number(a.replace(',', '.')) === Number(b.replace(',', '.'));

/** Значение показателя по профилю: только если все подтверждённые факты называют одно число. */
function confirmedValue(facts: readonly string[], measure: number): string | null {
  const values = facts.flatMap((fact) =>
    mentions(fact)
      .filter((item) => item.measure === measure)
      .map((item) => item.value),
  );
  if (values.length === 0) return null;
  return values.every((value) => same(value, values[0]!)) ? values[0]! : null;
}

export function correctedText(text: string, facts: readonly string[]): string {
  return mentions(text)
    .reverse()
    .reduce((current, item) => {
      const value = confirmedValue(facts, item.measure);
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
