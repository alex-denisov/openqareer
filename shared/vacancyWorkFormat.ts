/**
 * Формат работы вакансии (B446-g4): один разбор для фильтра «Формат», колонки «Гео»
 * и статуса строки 390. Сервер считает его до того, как страница подборки обрежет
 * выжимку, и отдаёт полем `workFormat`.
 */
export type VacancyWorkFormat = 'hybrid' | 'office' | 'remote' | 'unknown';

const REMOTE_PLACE = /\bremote\b|удал[её]нн/u;
/** «office», но не «officer» и не «back office». */
const OFFICE = /офис|\bon[- ]?site\b|\bin[- ]?person\b|(?<!\b(?:back|front|middle|home|head)[- ])\boffices?\b/u;

export function detectVacancyWorkFormat(input: {
  readonly location?: string;
  readonly summary?: string;
  readonly isRemote: boolean;
}): VacancyWorkFormat {
  const location = (input.location ?? '').toLocaleLowerCase('ru-RU');
  const context = `${location} ${input.summary ?? ''}`.toLocaleLowerCase('ru-RU');
  if (/гибрид|hybrid/u.test(context)) return 'hybrid';
  // Признак площадки и «Remote» в месте сильнее слова «офис» в тексте: строка «Удалённо · везде»
  // подписывалась «офис» из-за «Chief Operating Officer» и «офисов» в рассказе о компании.
  if (input.isRemote || REMOTE_PLACE.test(location)) return 'remote';
  return OFFICE.test(context) ? 'office' : 'unknown';
}

const LABELS: Readonly<Record<VacancyWorkFormat, string | undefined>> = {
  hybrid: 'гибрид',
  office: 'офис',
  remote: 'удалённо',
  unknown: undefined,
};

export function workFormatLabel(format: VacancyWorkFormat): string | undefined {
  return LABELS[format];
}
