/** Каналы отклика (B787): куда на самом деле уходит отклик на вакансию. */
export const APPLY_CHANNEL_LABELS = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  recruitee: 'Recruitee',
  teamtailor: 'Teamtailor',
  personio: 'Personio',
  breezy: 'Breezy',
  bamboohr: 'BambooHR',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  oracle: 'Oracle',
  workday: 'Workday',
  icims: 'iCIMS',
  telegram: 'Telegram',
  email: 'почта',
  /** Площадка вакансий без своей формы в списке выше (Himalayas, getmatch, Хабр, HN…). */
  board: 'площадка',
  site: 'сайт компании',
} as const;

export type ApplyChannel = keyof typeof APPLY_CHANNEL_LABELS;

/** Откуда известна цель: адрес записи, тот же кластер, текст вакансии, переход трекера. */
export type ApplyTargetOrigin = 'url' | 'cluster' | 'text' | 'redirect';

export interface ApplyTarget {
  readonly channel: ApplyChannel;
  /** Канонический адрес вакансии; для почты — пост, где она названа. */
  readonly url: string;
  /** Адрес формы: страница отклика ATS, `mailto:` или тот же `url`. */
  readonly formUrl: string;
  readonly origin: ApplyTargetOrigin;
  /** Адрес — трекер: конечная площадка узнаётся переходом по действию кандидата. */
  readonly needsRedirect?: true;
}
