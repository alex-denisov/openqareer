/** Измеримый результат: 3 — доля, деньги или кратный рост, 2 — изменение «с 4 до 11», 1 — количество, 0 — чисел нет. */
const MEASURED =
  /\d\s*[–-]?\s*%|процент|\bpercent|[$€£₽¥]\s*\d|\d\s*[₽€$]|(?<!\p{L})(?:usd|eur|rub)\s*\d|(?<![\p{L}\d])\d[\d.,]*(?:[kmb](?![\p{L}\d²])|\s*(?:млн|млрд|тыс|million|billion|руб|usd|eur))|(?<![\p{L}\d])\d+\s?[x×](?![\p{L}\d])|(?<!\p{L})в\s+\d[\d.,]*\s+раза?(?!\p{L})|\d\s+times\b|(?<!\p{L})(?:doubled|tripled|вдвое|втрое)(?!\p{L})/iu;
const CHANGE =
  /\bfrom\s+(?:about\s+)?~?\d[^.;]{0,40}?\bto\s+(?:about\s+)?~?\d|\d\s+(?:hours?|days?|weeks?|months?|minutes?|seconds?|people|engineers|users)\s+to\s+(?:about\s+)?~?\d|(?<!\p{L})(?:с|со|от)\s+\d[^.;]{0,30}?\sдо\s+\d|\d\s*(?:→|->)\s*\d/iu;
/** Даты, уровни, версии и номера стандартов — не количество. */
const NOT_A_COUNT =
  /(?<!\d)(?:\d{1,2}[./])?\d{1,2}[./](?:19|20)\d{2}(?!\d)|(?<![\d$€£₽¥])(?:19|20)\d{2}(?![\d%])|24\s*[/x×]\s*7|\b(?:ISO(?:\/IEC)?|IEC|PCI|SOC|RFC|ITIL|COBIT|Office|Microsoft|Windows|Dynamics|Oracle|ГОСТ|ФЗ)[\s-]*v?\d[\d.:-]*|(?<!\p{L})(?:ISO|ГОСТ|ФЗ)\p{L}*[\s-]+\d[\d.:-]*|\d+-ФЗ|\p{L}+\d+|\d+(?:st|nd|rd|th)\b/giu;

export function resultStrength(text: string): number {
  if (MEASURED.test(text)) return 3;
  const counts = text.replace(NOT_A_COUNT, ' ');
  if (CHANGE.test(counts)) return 2;
  return /\d/u.test(counts) ? 1 : 0;
}

/** Результат, а не просто количество: только он меняет порядок пунктов. */
export const isResult = (text: string): boolean => resultStrength(text) >= 2;
