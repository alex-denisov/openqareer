import { vacancySourceDisplayName } from '../../../../../shared/vacancySourceLabel';

/** Как площадка называется для кандидата. Внутренние коды источников на экран не выходят. */
export interface Platform {
  /** «hh.ru», «LinkedIn», «сайт компании». */
  readonly label: string;
  /** Отклик ушёл не через площадку вакансий, а на сайте работодателя. */
  readonly site: boolean;
}

const KNOWN: readonly (readonly [RegExp, string])[] = [
  [/^hh(\.ru)?$/u, 'hh.ru'],
  [/linkedin/u, 'LinkedIn'],
  [/^telegram/u, 'Telegram'],
  [/^remotive$/u, 'Remotive'],
  [/^trudvsem$/u, 'ТрудВсем'],
  [/^himalayas$/u, 'Himalayas'],
];
const SITE: Platform = { label: 'сайт компании', site: true };
/** Код, а не название: латиница в нижнем регистре, цифры, дефисы и подчёркивания. */
const CODE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;

export function platformOf(source: string | null | undefined): Platform {
  const raw = (source ?? '').trim();
  if (!raw) return SITE;
  const lower = raw.toLowerCase();
  const known = KNOWN.find(([pattern]) => pattern.test(lower));
  if (known) return { label: known[1], site: false };
  if (CODE.test(raw)) return SITE;
  return { label: vacancySourceDisplayName(raw), site: false };
}

/** «через hh.ru», «через сайт компании». */
export function viaPlatform(platform: Platform): string {
  return `через ${platform.label}`;
}

/** «на hh.ru», «на сайте компании». */
export function onPlatform(platform: Platform): string {
  return platform.site ? 'на сайте компании' : `на ${platform.label}`;
}

/** Заголовок шага отправки: «с hh.ru», «на сайте компании». */
export function sendFrom(platform: Platform): string {
  return platform.site ? 'на сайте компании' : `с ${platform.label}`;
}
