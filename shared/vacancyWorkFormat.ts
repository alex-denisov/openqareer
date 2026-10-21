/**
 * Формат работы вакансии (B446-g4): один разбор для фильтра «Формат», колонки «Гео»
 * и статуса строки 390. Сервер считает его до того, как страница подборки обрежет
 * выжимку, и отдаёт полем `workFormat`.
 */
export type VacancyWorkFormat = 'hybrid' | 'office' | 'remote' | 'unknown';

export function detectVacancyWorkFormat(input: {
  readonly location?: string;
  readonly summary?: string;
  readonly isRemote: boolean;
}): VacancyWorkFormat {
  const context = `${input.location ?? ''} ${input.summary ?? ''}`.toLocaleLowerCase('ru-RU');
  if (/гибрид|hybrid/u.test(context)) return 'hybrid';
  if (/офис|on[- ]?site|in[- ]?person|office/u.test(context)) return 'office';
  return input.isRemote ? 'remote' : 'unknown';
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
