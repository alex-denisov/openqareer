/** CPO 26.10: живые источники каталога для фильтра «Источники» — все, а не только реестр. */
export interface CatalogSourceEntry {
  readonly sourceId: string;
  readonly name: string;
  readonly category?: string;
  /** Живые записи источника в пуле. */
  readonly count: number;
}

const WORD_CASE: Readonly<Record<string, string>> = {
  hh: 'hh.ru',
  hn: 'HN',
  yc: 'YC',
  api: 'API',
};

function titleWords(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => WORD_CASE[word] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

const ATS_NAMES: Readonly<Record<string, string>> = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
};

/** «ats-greenhouse-stripe» → «Stripe · Greenhouse», «src-tg-react» → «Telegram: react». */
export function catalogSourceView(sourceId: string, count: number): CatalogSourceEntry {
  const ats = /^ats-([a-z]+)-(.+)$/u.exec(sourceId);
  if (ats) {
    const platform = ATS_NAMES[ats[1]!] ?? titleWords(ats[1]!);
    return {
      sourceId,
      name: `${titleWords(ats[2]!)} · ${platform}`,
      category: 'ATS компаний',
      count,
    };
  }
  const telegram = /^src-tg-(.+)$/u.exec(sourceId);
  if (telegram)
    return { sourceId, name: `Telegram: ${telegram[1]}`, category: 'Telegram каналы', count };
  return { sourceId, name: titleWords(sourceId.replace(/^src-/u, '')), count };
}
