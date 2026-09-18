import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { ATS_BOARD_MEASUREMENTS, ATS_BOARD_SOURCES } from './atsBoardSources';
import { WORKDAY_BOARD_MEASUREMENTS, WORKDAY_BOARD_SOURCES } from './workdayBoardSources';
import { MEASUREMENTS } from './vacancySourceMeasurementData';

const linkedInCrawlerAccountIds = (process.env.LINKEDIN_ACCOUNT_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const linkedInCrawlerEnabled = linkedInCrawlerAccountIds.length > 0;

/**
 * The three access classes the owner named for B164: what may be read from the
 * open web without hard limits, what has a working official interface, and
 * what exists only inside the candidate's own browser session (ADR-009).
 */
type VacancyAccessClass = 'open_web' | 'api' | 'browser_session';

/**
 * Откуда сделан замер. Введено в B199, когда проба с трёх маршрутов показала,
 * что «источник молчит» и «наш канал не дотянул» до сих пор выглядели
 * одинаково: ТрудВсем отдаёт 322 КБ российскому ЦОДу и обрывается на 30 КБ для
 * прод-VM в EU, а RemoteOK ровно наоборот. Замер без маршрута — не факт.
 *
 *   eu-prod   — прод-VM во Франкфурте: маршрут, на котором работает продукт
 *   ru-dc     — российский ЦОД (`eterapy-2`, Cloud.ru)
 *   ru-owner  — домашний канал владельца (Москва), см. INC-036
 */
export type VacancySourceRoute = 'eu-prod' | 'ru-dc' | 'ru-owner';

/**
 * Что установила проба про сам адрес — отдельно от того, включён источник или
 * нет. Статус ставится только по наблюдению (B199).
 *
 *   live                     — адрес отдаёт записи
 *   needs_browser_session    — анти-бот отвечает `403` честному агенту; читать
 *                              только в браузерной сессии кандидата (B206)
 *   robots_forbidden         — площадка запретила словами в `robots.txt`
 *   address_lost             — домена нет, либо адрес отдаёт оболочку вместо
 *                              данных: нужен новый адрес, найденный вручную
 *   route_limited            — жив, но не с того маршрута, на котором продукт
 *   official_access_required — нужен официальный доступ партнёра (INC-022)
 */
export type VacancyAddressStatus =
  | 'live'
  | 'needs_browser_session'
  | 'robots_forbidden'
  | 'address_lost'
  | 'route_limited'
  | 'official_access_required';

export interface RegisteredVacancySource extends VacancySourceConfig {
  readonly accessClass: VacancyAccessClass;
  /** Which market the source actually covers, in the owner's region words. */
  readonly market: string;
  /** Что проба установила про адрес, независимо от того, включён ли источник. */
  readonly addressStatus: VacancyAddressStatus;
  /** Required when `enabled` is false: why the product keeps knowing about it. */
  readonly disabledReason?: string;
  /**
   * True when the endpoint answers nothing usable without a search term, so a
   * scheduled query-less sync must skip it rather than record an empty result.
   */
  readonly requiresQuery?: boolean;
  /**
   * Content-signals площадки из её `robots.txt`. Разрешение читать ленту и
   * разрешение учить на её содержимом — разные вещи, и второе площадка часто
   * отзывает (`ai-train=no` у nodesk.co). Ограничение должно жить в реестре, а
   * не в памяти агента.
   */
  readonly contentSignals?: readonly string[];
}

export interface VacancySourceMeasurement {
  /** What a live request returned, counted from the response body. */
  readonly items: number;
  readonly observedAt: string;
  /** С какого маршрута сделан этот замер (B199). */
  readonly route: VacancySourceRoute;
  readonly note?: string;
}

/**
 * Замер с маршрута, на котором работает продукт. Именно он решает, можно ли
 * источник включать: остальные маршруты объясняют расхождения, но не дают
 * права на включение.
 */
export function vacancySourceMeasurement(sourceId: string): VacancySourceMeasurement | undefined {
  const readings = vacancySourceMeasurements(sourceId);
  if (readings.length === 0) return undefined;
  return readings.find((reading) => reading.route === 'eu-prod') ?? readings[0];
}

/** Все замеры источника, со всех маршрутов, в порядке записи. */
export function vacancySourceMeasurements(sourceId: string): readonly VacancySourceMeasurement[] {
  // Доски работодателей замерены отдельной пробой и живут своим списком: их
  // сотни, и держать их в одной таблице с площадками — значит перестать её
  // читать глазами (B202).
  return (
    MEASUREMENTS[sourceId] ??
    ATS_BOARD_MEASUREMENTS[sourceId] ??
    WORKDAY_BOARD_MEASUREMENTS[sourceId] ??
    []
  );
}

/**
 * Sources the product knows how to contact.
 *
 * Removed on 2026-08-30 because a live probe proved they can never return
 * anything, and shipping them made the network look wider than it is:
 * `src-superjob` and `src-zarplata` (the export addresses answer HTML and 404),
 * plus eleven Telegram channels whose public web view carries no posts at all.
 *
 * Добавлено 2026-09-05 (B199): найденные пробой ленты (`src-nodesk`,
 * `src-himalayas-api`, `src-themuse`) и **названные владельцем площадки,
 * которые сервер не имеет права опрашивать** — они зарегистрированы
 * выключенными, чтобы отказ был назван, а не забыт. Владелец: «Не отсекай
 * площадки типа linkedin, glassdoor и другие у которых антиботы».
 */
const PLATFORM_SOURCES: readonly RegisteredVacancySource[] = [
  {
    id: 'src-trudvsem',
    name: 'Работа в России (ТрудВсем)',
    type: 'json_api',
    accessClass: 'api',
    market: 'Россия',
    addressStatus: 'robots_forbidden',
    enabled: false,
    disabledReason:
      'Два независимых препятствия. Первое: robots.txt площадки содержит Disallow: / — она отказала словами (замер 2026-09-05). Второе: маршрут продукта её всё равно не обслуживает — с прод-VM в EU тело обрывается на 31 291 байте за 45 с, тогда как из российского ЦОДа приходит 322 121 байт за 5,4 с.',
    targetUrl: 'https://opendata.trudvsem.ru/api/v1/vacancies?limit=100',
    refreshIntervalMinutes: 180,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-habr-career',
    name: 'Хабр Карьера',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Россия',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://career.habr.com/vacancies/rss',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-arbeitnow',
    name: 'Arbeitnow (Германия и EU)',
    type: 'json_api',
    accessClass: 'api',
    market: 'EU',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.arbeitnow.com/api/job-board-api',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-remoteok',
    name: 'RemoteOK',
    type: 'json_api',
    accessClass: 'api',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://remoteok.com/api',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-weworkremotely',
    name: 'We Work Remotely',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://weworkremotely.com/remote-jobs.rss',
    // «Reddit: Director, Privacy Legal» — форма измерена на живой ленте 2026-09-06.
    employerShape: 'title-colon-prefix',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-jobicy',
    name: 'Jobicy',
    type: 'json_api',
    accessClass: 'api',
    market: 'Удалённо, US и EU',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://jobicy.com/api/v2/remote-jobs?count=50',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-workingnomads',
    name: 'Working Nomads',
    type: 'json_api',
    accessClass: 'api',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.workingnomads.com/api/exposed_jobs/',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-getonbrd',
    name: 'Get on Board (LATAM)',
    type: 'json_api',
    accessClass: 'api',
    market: 'LATAM',
    addressStatus: 'live',
    enabled: true,
    // `expand=["company"]` отдаёт имя работодателя, которого не хватало в
    // B216; веер по категориям — в pagedJsonSources (B217).
    targetUrl:
      'https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=100&expand=%5B%22company%22%5D',
    contentSignals: ['search=yes', 'ai-train=no', 'use=reference'],
    refreshIntervalMinutes: 180,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-himalayas',
    name: 'Himalayas',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://himalayas.app/jobs/rss',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-himalayas-api',
    name: 'Himalayas (JSON API)',
    type: 'json_api',
    accessClass: 'api',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    // Курсорная лента от свежих к старым: опрос читает 25 страниц по 20 и
    // дополняет срез (B216). RSS-источник `src-himalayas` остаётся: он даёт
    // те же вакансии, и дедупликатор их склеит.
    enabled: true,
    targetUrl: 'https://himalayas.app/jobs/api?limit=20',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-nodesk',
    name: 'NoDesk',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://nodesk.co/remote-jobs/index.xml',
    // «Staff Systems Engineer, IT at GitLab» — форма измерена на живой ленте 2026-09-06.
    employerShape: 'title-at-suffix',
    refreshIntervalMinutes: 120,
    // `Allow: /` нам, но площадка отзывает право учить модели на её контенте и
    // запрещает ClaudeBot, GPTBot, CCBot, Bytespider и других (2026-09-05).
    contentSignals: ['search=yes', 'ai-train=no', 'use=reference'],
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-themuse',
    name: 'The Muse',
    type: 'json_api',
    accessClass: 'api',
    market: 'US',
    addressStatus: 'live',
    // Категории — те же «белые воротнички», что и фильтр hh.ru (B214): роль,
    // где резюме имеет значение. `page` у площадки не больше 99, поэтому
    // выдача дробится веером «категория × уровень», по кругу от времени (B216).
    enabled: true,
    targetUrl:
      'https://www.themuse.com/api/public/jobs?page=1&category=Software%20Engineering&category=Data%20and%20Analytics&category=Data%20Science&category=Design%20and%20UX&category=Product%20Management&category=Project%20Management&category=Computer%20and%20IT&category=IT&category=Business%20Operations&category=Sales&category=Marketing&category=Account%20Management&category=Accounting%20and%20Finance&category=Human%20Resources%20and%20Recruitment&category=Legal%20Services&category=Science%20and%20Engineering&category=Management&category=Writing%20and%20Editing&category=Media%2C%20PR%2C%20and%20Communications&category=Education&category=Medical%2C%20Clinical%20and%20Veterinary&category=Customer%20Service',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'remotive',
    name: 'Remotive (Global Remote)',
    type: 'json_api',
    accessClass: 'api',
    market: 'Удалённо, мир',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://remotive.com/api/remote-jobs',
    // Решение владельца 2026-09-14 (B217): robots.txt площадки закрывает
    // /api/* краулерам, но тот же API задокументирован площадкой для
    // распространения её вакансий — со ссылкой на Remotive, упоминанием
    // источника и не чаще 4 раз в сутки. Реестр печатает атрибуцию
    // (vacancySourceRegistry), интервал держит их условие.
    robotsOverride: {
      grantedBy: 'owner',
      grantedOn: '2026-09-14',
      basis:
        'https://remotive.com/api-documentation — публичный API для распространения вакансий со ссылкой на Remotive; ≤ 4 запросов в сутки',
    },
    refreshIntervalMinutes: 360,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-react',
    name: 'Telegram @job_react',
    type: 'telegram',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://t.me/s/job_react',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-product',
    name: 'Telegram @product_jobs',
    type: 'telegram',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://t.me/s/product_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-datascience',
    name: 'Telegram @datasciencejobs',
    type: 'telegram',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://t.me/s/datasciencejobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-gamedev',
    name: 'Telegram @gamedevjob',
    type: 'telegram',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://t.me/s/gamedevjob',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-tg-marketing',
    name: 'Telegram @marketing_jobs',
    type: 'telegram',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://t.me/s/marketing_jobs',
    refreshIntervalMinutes: 30,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'hh',
    name: 'hh.ru (официальный API)',
    type: 'hh',
    accessClass: 'api',
    market: 'Россия и СНГ',
    addressStatus: 'official_access_required',
    enabled: false,
    disabledReason:
      'Соискательский API hh.ru отвечает 403 без официального доступа партнёра (INC-022). Тот же 403 получен со всех трёх маршрутов 2026-09-05, то есть дело не в географии. Источник оставлен в реестре, чтобы отказ был назван, а не забыт (B175).',
    targetUrl: 'https://api.hh.ru/vacancies',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-hh-search',
    name: 'hh.ru (страница поиска)',
    type: 'hh_search',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: true,
    // Обход веером по ролям: набор ролей выбирает владелец в суперадминке,
    // по умолчанию — категория «Информационные технологии» (25 ролей, 38 030
    // вакансий за 30 дней по замеру 2026-09-13). Быстрый проход раз в двадцать
    // минут добирает свежее, глубокий раз в сутки — полноту (B214).
    //
    // Про `robots.txt` площадки владелец решил 2026-09-13, получив измерение:
    // `Disallow: *?*` запрещает адреса с параметрами, и обход разворачивается
    // по его прямому указанию. Отказ агента здесь был бы блокировкой владельца
    // по площадочным основаниям, которую контракт запрещает.
    targetUrl: 'https://hh.ru/search/vacancy',
    refreshIntervalMinutes: 20,
    requiresQuery: false,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-hh-rss',
    name: 'hh.ru (публичный RSS поиска)',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Россия и СНГ',
    addressStatus: 'live',
    enabled: false,
    disabledReason:
      'Живая проверка 2026-09-05 со всех трёх маршрутов: hh.ru/search/vacancy/rss?text= отвечает 200 и отдаёт 20 вакансий, учитывая запрос. Это другая поверхность, чем закрытый api.hh.ru, но владелец уже принимал решение по доступу к hh.ru (B175) — включение ждёт его прямого ответа, а не решения агента.',
    targetUrl: 'https://hh.ru/search/vacancy/rss',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-amazon-jobs',
    name: 'Amazon',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (карьерный сайт Amazon)',
    addressStatus: 'live',
    enabled: true,
    // `sort=recent`: 20 страниц по 100 за опрос — свежие две тысячи; хвост до
    // потолка 10 000 доходит частичными чтениями (B216).
    targetUrl: 'https://www.amazon.jobs/en/search.json?result_limit=100&sort=recent',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-netflix',
    name: 'Netflix',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (карьерный сайт Netflix, Eightfold)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&num=10',
    refreshIntervalMinutes: 240,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-apple-jobs',
    name: 'Apple',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (карьерный сайт Apple)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://jobs.apple.com/api/v1/search',
    refreshIntervalMinutes: 240,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-microsoft-careers',
    name: 'Microsoft',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (карьерный сайт Microsoft, Eightfold)',
    addressStatus: 'live',
    enabled: true,
    targetUrl:
      'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&num=10&sort_by=timestamp',
    refreshIntervalMinutes: 240,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-qualcomm-careers',
    name: 'Qualcomm',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (карьерный сайт Qualcomm, Eightfold)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com',
    refreshIntervalMinutes: 240,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-hn-whoishiring',
    name: 'Hacker News',
    type: 'json_api',
    accessClass: 'api',
    market: 'Мир (Hacker News Who is hiring, Algolia API)',
    addressStatus: 'live',
    enabled: true,
    targetUrl:
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Ask+HN:+Who+is+hiring',
    refreshIntervalMinutes: 360,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-crossover',
    name: 'Crossover',
    type: 'json_api',
    accessClass: 'open_web',
    market: 'Удалённо, мир (Crossover)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.crossover.com/sitemap.xml',
    refreshIntervalMinutes: 360,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-indeed',
    name: 'Indeed',
    type: 'json_api',
    accessClass: 'api',
    market: 'US, EU, MENA, APAC, LATAM, СНГ (мобильный API Indeed, 63 рынка)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://apis.indeed.com/graphql',
    // apis.indeed.com/robots.txt — User-agent: * Disallow: / (сам сайт
    // indeed.com при этом Allow: / на поиск). Включено по прямому решению
    // владельца (B218): это тот же адрес, которым ходит мобильное приложение
    // Indeed тем же ключом; учётной записи и капчи нет. Темп вежливый.
    robotsOverride: {
      grantedBy: 'owner',
      grantedOn: '2026-09-14',
      basis:
        'Прямое решение владельца (B218): мобильный GraphQL Indeed (механика JobSpy) — тот же адрес и ключ приложения, что у iOS-клиента Indeed; вакансии Indeed критичны для продукта. robots хоста apis.indeed.com запрещает краулеров, но продукт ходит как клиент приложения, не как краулер.',
    },
    // Час: веер «роль × город» (308 комбинаций) проходится за сутки (B218).
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-linkedin-guest',
    name: 'LinkedIn',
    type: 'json_api',
    accessClass: 'open_web',
    market: 'US, EU, MENA, APAC, LATAM, СНГ, Россия, удалёнка (гостевой список LinkedIn)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
    // robots.txt LinkedIn запрещает /jobs-guest/ словами; включено по прямому,
    // трижды повторённому решению владельца (B218). Гостевой список открыт без
    // учётной записи; капчу не решаем, аккаунт не вводим.
    robotsOverride: {
      grantedBy: 'owner',
      grantedOn: '2026-09-14',
      basis:
        'Прямое решение владельца (B218, повторено трижды): гостевой список /jobs-guest/ открыт без учётной записи; вакансии LinkedIn критичны для продукта. Темп вежливый, на 429 источник останавливается.',
    },
    // Полтора часа: веер по 4 комбинации за опрос (B218).
    refreshIntervalMinutes: 90,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-linkedin-crawler',
    name: 'LinkedIn (Obscura Crawler)',
    type: 'linkedin_crawler',
    accessClass: 'browser_session',
    market: 'US, EU, MENA, APAC, LATAM, СНГ, Россия, удалёнка (серверный сбор Obscura)',
    addressStatus: 'live',
    enabled: linkedInCrawlerEnabled,
    ...(linkedInCrawlerEnabled
      ? {}
      : { disabledReason: 'account_pool_unconfigured: LINKEDIN_ACCOUNT_IDS не задан' }),
    targetUrl: 'https://www.linkedin.com/jobs/search',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-aijobs',
    name: 'aijobs.net',
    type: 'rss',
    accessClass: 'open_web',
    market: 'Удалённо, мир',
    addressStatus: 'address_lost',
    enabled: false,
    disabledReason:
      'Адрес ленты не найден: /feed/, /rss/, /api/jobs/ и /sitemap.xml отдают одну и ту же оболочку приложения в 10 836 байт со всех трёх маршрутов (2026-09-05). Площадка названа владельцем и остаётся в реестре, пока адрес не найден вручную.',
    targetUrl: 'https://aijobs.net/feed/',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-glassdoor',
    name: 'Glassdoor',
    type: 'json_api',
    accessClass: 'api',
    market: 'Global / US / EU (Glassdoor GraphQL & Obscura Stealth)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.glassdoor.com/graph',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-bayt',
    name: 'Bayt',
    type: 'career_site',
    accessClass: 'open_web',
    market: 'Middle East / Gulf / International (Bayt HTML & Obscura Stealth)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.bayt.com/en/international/jobs/',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-monster',
    name: 'Monster',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'US и EU',
    addressStatus: 'needs_browser_session',
    enabled: false,
    disabledReason:
      'Отвечает 403 честному агенту со всех трёх маршрутов (2026-09-05). Читается только в браузерной сессии кандидата (B206).',
    targetUrl: 'https://www.monster.com/jobs/q-remote-jobs',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-naukri',
    name: 'Naukri',
    type: 'json_api',
    accessClass: 'api',
    market: 'Индия, APAC (API поиска Naukri, механика JobSpy)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://www.naukri.com/jobapi/v3/search',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-bdjobs',
    name: 'BDJobs',
    type: 'json_api',
    accessClass: 'api',
    market: 'Бангладеш, Южная Азия (API поиска BDJobs, механика JobSpy)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://gateway.bdjobs.com/v1/api/jobsearch',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-ziprecruiter',
    name: 'ZipRecruiter',
    type: 'json_api',
    accessClass: 'api',
    market: 'US, Canada (мобильный API ZipRecruiter)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: 'https://api.ziprecruiter.com/jobs-app/jobs',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-wellfound',
    name: 'Wellfound (бывший AngelList)',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'Стартапы, мир',
    addressStatus: 'needs_browser_session',
    enabled: false,
    disabledReason:
      'Ленты у площадки нет: jobs.rss отвечает редиректом, а поиск вакансий закрыт логином (2026-09-05). Читается только в браузерной сессии кандидата (B206).',
    targetUrl: 'https://wellfound.com/jobs',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
];

/**
 * Площадки плюс доски работодателей, найденные живой пробой (B202). Доска
 * компании — такой же источник: у него тот же разбор и те же правила честности,
 * просто адрес строится из провайдера и слага, а не пишется руками.
 */
export const DEFAULT_VACANCY_SOURCES: readonly RegisteredVacancySource[] = [
  ...PLATFORM_SOURCES,
  ...ATS_BOARD_SOURCES,
  ...WORKDAY_BOARD_SOURCES,
];
