/**
 * Разобранный текст документа отдаётся страницами.
 *
 * Прод отвечал на `GET /api/v1/candidate/documents/:documentId` 20 469 байтами
 * и обрывал тело на середине строки: JSON приходил невалидным, а обрывался
 * именно `extractedText` (INC-034). Порог тот же, что у подбора (INC-029),
 * снимка кандидата (INC-030) и списка вакансий админ-консоли (INC-032), и
 * лечится он тем же доказанным бюджетом 12 288 байт.
 *
 * Отличие в том, что здесь длинное одно поле одной записи: пагинация записями
 * не помогает, режется сам текст. Смещение считается в единицах длины строки
 * JavaScript, чтобы клиент просто складывал страницы подряд, а граница никогда
 * не проходит внутри суррогатной пары — иначе склейка дала бы битый символ.
 */
export const DOCUMENT_TEXT_PAGE_BYTE_BUDGET = 12_288;

export interface DocumentTextPage {
  readonly text: string;
  readonly offset: number;
  /** Смещение следующей страницы; `null` — текст кончился. */
  readonly nextOffset: number | null;
  /** Полная длина текста в тех же единицах, что и смещение. */
  readonly length: number;
}

export function buildDocumentTextPage(
  text: string,
  offset: number,
  budgetBytes: number = DOCUMENT_TEXT_PAGE_BYTE_BUDGET,
): DocumentTextPage {
  const start = Math.min(Math.max(0, Math.trunc(offset)), text.length);
  let size = 0;
  let end = start;

  while (end < text.length) {
    const code = text.codePointAt(end);
    if (code === undefined) break;
    const unit = String.fromCodePoint(code);
    const cost = Buffer.byteLength(unit, 'utf8');
    if (size + cost > budgetBytes) break;
    size += cost;
    end += unit.length;
  }

  return {
    text: text.slice(start, end),
    offset: start,
    nextOffset: end < text.length ? end : null,
    length: text.length,
  };
}
