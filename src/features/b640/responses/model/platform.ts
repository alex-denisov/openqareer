import { vacancySourceDisplayName } from '../../../../../shared/vacancySourceLabel';

/** Как площадка называется для кандидата. Внутренние коды источников на экран не выходят. */
export interface Platform {
  /** «hh.ru», «LinkedIn», «сайт компании». */
  readonly label: string;
  /** Отклик ушёл не через площадку вакансий, а на сайте работодателя. */
  readonly site: boolean;
}

const KNOWN: readonly (readonly [RegExp, string])[] = [
  [/^hh(\.ru)?(?:[-._].*)?$/u, 'hh.ru'],
  [/^indeed/u, 'Indeed'],
  [/^linkedin/u, 'LinkedIn'],
  [/^telegram/u, 'Telegram'],
  [/^remotive$/u, 'Remotive'],
  [/^trudvsem$/u, 'ТрудВсем'],
  [/^himalayas/u, 'Himalayas'],
];
/** Коды freehire «src-fh-…»: из них площадки вакансий — эти, остальные — карьерные сайты компаний. */
const FREEHIRE = /^fh[-._](.+)$/u;
const FREEHIRE_PLATFORMS: ReadonlyMap<string, string> = new Map([
  ['getmatch', 'Getmatch'],
  ['habr-career', 'Хабр Карьера'],
]);
const SITE: Platform = { label: 'сайт компании', site: true };
/**
 * Внутренние обозначения источника: доска работодателя (`ats-ashby-snowflake`), тип чтения
 * (`json_api`, `rss`, `html`), ручная карточка. Всё это для кандидата — «сайт компании».
 */
const INTERNAL = /^(?:ats[-._]|cluster[-._]|direct[-._]|site[-._]|json[-_]?api$|rss$|html$|manual$|other$|unknown$)/u;

export function platformOf(source: string | null | undefined): Platform {
  const raw = (source ?? '').trim();
  if (!raw) return SITE;
  // Пометка в скобках («hh.ru (страница поиска)») — внутреннее различие сбора, её убираем первой.
  const name = vacancySourceDisplayName(raw);
  // Коды сбора «src-hh-search», «src-indeed»: приставка — внутреннее имя канала, не площадка.
  const lower = name.toLowerCase().replace(/^src[-._]/u, '');
  const feed = FREEHIRE.exec(lower)?.[1];
  if (feed) {
    const label = FREEHIRE_PLATFORMS.get(feed);
    return label ? { label, site: false } : SITE;
  }
  if (INTERNAL.test(lower)) return SITE;
  const known = KNOWN.find(([pattern]) => pattern.test(lower));
  if (known) return { label: known[1], site: false };
  const bare = name.replace(/^src[-._]/iu, '');
  return { label: bare.charAt(0).toUpperCase() + bare.slice(1), site: false };
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
