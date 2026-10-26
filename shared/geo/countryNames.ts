import { COUNTRY_NAMES } from '../locationGazetteer';

/**
 * Русское название страны по ISO 3166-1 alpha-2 — один источник для справочника
 * географии и списков релокации. Основа — Unicode CLDR через `Intl.DisplayNames`;
 * короткие подписи продукта («США», «ОАЭ») — из `locationGazetteer`, ими уже
 * сохранены выборы «Локаций».
 */
const EXTRA_NAMES: Readonly<Record<string, string>> = { XK: 'Косово' };

let displayNames: Intl.DisplayNames | null = null;

export function countryNameRu(code: string): string {
  const upper = code.toUpperCase();
  const own = COUNTRY_NAMES[upper.toLowerCase()] ?? EXTRA_NAMES[upper];
  if (own) return own;
  try {
    displayNames ??= new Intl.DisplayNames(['ru'], { type: 'region' });
    return displayNames.of(upper) ?? upper;
  } catch {
    return upper;
  }
}
