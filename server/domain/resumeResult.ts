/** Измеримый результат: 3 — доля, деньги или кратный рост, 2 — рост «с 4 до 11», 1 — количество, 0 — чисел нет. */
const MEASURED =
  /\d\s*[–-]?\s*%|процент|\bpercent|[$€£₽¥]\s*\d|\d\s*[₽€$]|(?<!\p{L})(?:usd|eur|rub)\s*\d|(?<![\p{L}\d])\d[\d.,]*(?:[kmb](?![\p{L}\d²])|\s*(?:млн|млрд|тыс|million|billion|руб|usd|eur))|(?<![\p{L}\d])\d+\s?[x×](?![\p{L}\d])|(?<!\p{L})(?:doubled|tripled|вдвое|втрое)(?!\p{L})/iu;
const GROWTH =
  /\bfrom\s+(?:about\s+)?~?\d[^.;]{0,40}?\bto\s+(?:about\s+)?~?\d|(?<!\p{L})(?:с|со|от)\s+\d[^.;]{0,30}?\sдо\s+\d|\d\s*(?:→|->)\s*\d/iu;
const NOT_A_COUNT =
  /(?<!\d)(?:19|20)\d{2}(?!\d)|24\s*\/\s*7|\b[LТTЛ]\d\b|\bITIL\s*v?\d|\p{L}+\d+|\d+(?:st|nd|rd|th)\b/giu;

export function resultStrength(text: string): number {
  if (MEASURED.test(text)) return 3;
  if (GROWTH.test(text) && !/(?:19|20)\d{2}/u.test(text)) return 2;
  return /\d{2,}/u.test(text.replace(NOT_A_COUNT, '')) ? 1 : 0;
}
