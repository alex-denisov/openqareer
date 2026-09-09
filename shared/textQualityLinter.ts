/**
 * Проверка текста на штампы генеративных моделей (B210).
 *
 * ПОЧЕМУ КОД, А НЕ ТОЛЬКО НАВЫК. Навык `anti-slop-humanizer` учит человека и
 * агента писать без штампов, но учит он словами: забыть его нечем, кроме
 * внимательности. Эта проверка — тот же реестр, который может стоять в тесте и
 * падать. Одно место правды: тест паритета не даёт реестру разойтись с навыком.
 *
 * Проверка ничего не исправляет сама. Штамп в живом тексте иногда законен —
 * «экосистема» в буквальном смысле, «синергия» в цитате, — и молча переписать
 * чужой текст хуже, чем назвать место человеку. Невидимые метки, в отличие от
 * штампов, снимаются без спроса: их автор не писал (`shared/textHygiene.ts`).
 */

/**
 * Русский реестр штампов. Английский живёт целиком в навыке
 * (`references/patterns.md`, проект `conorbronsdon/avoid-ai-writing`, MIT):
 * там уровни серьёзности и исключения, которые в список слов не сворачиваются.
 */
export const RU_SLOP_REGISTRY: readonly string[] = [
  'уникальный',
  'инновационный',
  'революционный',
  'передовой',
  'мощный инструмент',
  'в современном мире',
  'в эпоху цифровизации',
  'раскрыть потенциал',
  'эффективное решение',
  'ключевой драйвер',
  'синергия',
  'экосистема',
  'важно отметить',
  'стоит подчеркнуть',
  'таким образом',
  'в заключение',
  'позволяет вам',
  'поможет вам',
  'мы верим, что',
  'наша миссия',
  'погружаясь в',
  'отправляясь в путешествие',
];

export interface TextQualityFinding {
  /** Штамп в том виде, в каком он записан в реестре. */
  readonly phrase: string;
  /** Смещение находки в тексте — чтобы человек увидел место, а не догадывался. */
  readonly index: number;
}

const WORD_EDGE = /[\p{L}\p{N}]/u;

function standsAlone(text: string, start: number, length: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = start + length < text.length ? text[start + length] : '';
  return !WORD_EDGE.test(before ?? '') && !WORD_EDGE.test(after ?? '');
}

/**
 * Находки в порядке появления в тексте. Пустой список означает «штампов из
 * реестра нет», а не «текст хорош»: реестр ловит слова, а не смысл.
 */
export function lintTextQuality(
  text: string,
  registry: readonly string[] = RU_SLOP_REGISTRY,
): TextQualityFinding[] {
  const haystack = text.toLowerCase();
  const findings: TextQualityFinding[] = [];

  for (const phrase of registry) {
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(phrase, from);
      if (index < 0) break;
      // «Экосистемные услуги» — не «экосистема»: проверка смотрит на границы
      // слова, иначе она ловила бы половину живого текста.
      if (standsAlone(haystack, index, phrase.length)) findings.push({ phrase, index });
      from = index + phrase.length;
    }
  }

  return findings.sort((left, right) => left.index - right.index);
}
