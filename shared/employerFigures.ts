/**
 * Убирает из текста цифры работодателя: деньги, проценты, крупные суммы и предлог перед ними.
 * Счёт людей и штук остаётся — это не внутренние показатели.
 */
export function withoutEmployerFigures(text: string): string {
  const unit = String.raw`(?:%|процент\p{L}*|percent|млн\.?|млрд\.?|миллион\p{L}*|миллиард\p{L}*|тыс\p{L}*\.?|k|m|bn|₽|руб\p{L}*\.?|usd|eur|евро|долл\p{L}*\.?|\$|€)(?![\p{L}\d])`;
  const money = String.raw`(?:₽|руб\p{L}*\.?|usd|eur|евро|долл\p{L}*\.?|\$|€)`;
  const figure = new RegExp(
    String.raw`(?:(?<=^|\s)(?:до|на|с|в|по|от)\s+)?[-+$€]?\d[\d\s.,]*\s*${unit}(?:\s*${money}(?![\p{L}\d]))?`,
    'giu',
  );
  return text
    .replace(figure, '')
    .replace(/\s+,/gu, ',')
    .replace(/\s{2,}/gu, ' ')
    .replace(/[\s,]+$/u, '')
    .trim();
}

const squash = (text: string): string => text.replace(/[\s,]+/gu, ' ').trim();

/** В строке остались цифры работодателя: проценты, деньги, крупные суммы. */
export function hasEmployerFigures(text: string): boolean {
  return squash(withoutEmployerFigures(text)) !== squash(text);
}
