import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { ATS_BOARD_MEASUREMENTS, ATS_BOARD_SOURCES } from './atsBoardSources';

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
 * What each address actually answered when it was probed. A registry entry
 * without a measurement is a guess, and guesses are what filled the section
 * with sources that could never return anything (B161 review §6, B164).
 *
 * Замеры 2026-09-05 сделаны одним инструментом
 * (`scripts/probe_vacancy_sources.py`, `curl --max-time 45`) с трёх маршрутов
 * подряд; полный отчёт — `docs/v1-release/tasks/evidence/B199-source-probe/`.
 */
const MEASUREMENTS: Readonly<Record<string, readonly VacancySourceMeasurement[]>> = {
  'src-trudvsem': [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'тело оборвалось на 31 291 байте за 45 с — маршрут продукта сервис не обслуживает',
    },
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'ru-dc',
      note: '322 121 байт за 5,4 с из российского ЦОДа: сервис жив и быстр, но его robots.txt запрещает обход (Disallow: /)',
    },
  ],
  'src-habr-career': [
    { items: 50, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 50, observedAt: '2026-09-05', route: 'ru-dc' },
    { items: 50, observedAt: '2026-09-05', route: 'ru-owner' },
  ],
  'src-arbeitnow': [
    {
      items: 175,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'EU / Germany board, one page',
    },
    { items: 0, observedAt: '2026-09-05', route: 'ru-dc', note: '403 с российского ЦОДа' },
  ],
  'src-remoteok': [
    {
      items: 101,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'first array element is licence metadata',
    },
    { items: 0, observedAt: '2026-09-05', route: 'ru-dc', note: '403 с российского ЦОДа' },
  ],
  'src-weworkremotely': [
    {
      items: 91,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'all categories, not only programming',
    },
    { items: 91, observedAt: '2026-09-05', route: 'ru-dc' },
    { items: 91, observedAt: '2026-09-05', route: 'ru-owner' },
  ],
  'src-jobicy': [
    { items: 50, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 50, observedAt: '2026-09-05', route: 'ru-dc' },
  ],
  'src-getonbrd': [
    {
      items: 50,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'LATAM; 50 записей приходят, но ни одна не несёт названия компании и публичной ссылки, поэтому ни одна не годится как карточка вакансии',
    },
    { items: 50, observedAt: '2026-09-05', route: 'ru-dc' },
  ],
  'src-workingnomads': [
    { items: 35, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 35, observedAt: '2026-09-05', route: 'ru-dc' },
  ],
  'src-himalayas': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod', note: 'atom feed' },
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'ru-dc',
      note: 'TLS-соединение не устанавливается с российских маршрутов',
    },
  ],
  'src-himalayas-api': [
    {
      items: 20,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'JSON-поверхность той же ленты, 150 971 байт; найдена пробой B199',
    },
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'ru-dc',
      note: 'TLS-соединение не устанавливается',
    },
  ],
  'src-nodesk': [
    {
      items: 10,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'RSS; найден пробой B199 — адрес /remote-jobs/index.xml, а не /rss.xml',
    },
    { items: 10, observedAt: '2026-09-05', route: 'ru-dc' },
    { items: 10, observedAt: '2026-09-05', route: 'ru-owner' },
  ],
  'src-themuse': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod', note: 'публичный API, страница 1' },
    { items: 20, observedAt: '2026-09-05', route: 'ru-dc' },
  ],
  remotive: [
    {
      items: 18,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'whole public feed; ?search= is ignored by the provider',
    },
    { items: 18, observedAt: '2026-09-05', route: 'ru-owner' },
    {
      items: 0,
      observedAt: '2026-09-06',
      route: 'eu-prod',
      note: 'robots.txt площадки читан с прод-VM: User-agent: * → Disallow: /api — обход запрещён словами (B204)',
    },
  ],
  // Замерено 2026-09-05 с прод-VM: подсчёт постов в публичном веб-виде канала
  // (`tgme_widget_message_wrap`). Телеграм отвечает EU-маршруту, хотя домашний
  // канал владельца до telegra.ph уже не доходит.
  'src-tg-product': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 20, observedAt: '2026-08-30', route: 'ru-owner' },
  ],
  'src-tg-gamedev': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 20, observedAt: '2026-08-30', route: 'ru-owner' },
  ],
  'src-tg-marketing': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 20, observedAt: '2026-08-30', route: 'ru-owner' },
  ],
  'src-tg-react': [
    { items: 20, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 20, observedAt: '2026-08-30', route: 'ru-owner' },
  ],
  'src-tg-datascience': [
    { items: 19, observedAt: '2026-09-05', route: 'eu-prod' },
    { items: 19, observedAt: '2026-08-30', route: 'ru-owner' },
  ],
  hh: [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'api.hh.ru/vacancies → 403 for an unauthorised search (INC-022, B175); тот же 403 со всех трёх маршрутов',
    },
  ],
  'src-hh-rss': [
    {
      items: 20,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'hh.ru/search/vacancy/rss?text= отвечает 200, отдаёт 20 вакансий и учитывает запрос',
    },
    { items: 20, observedAt: '2026-09-05', route: 'ru-dc' },
    { items: 20, observedAt: '2026-09-05', route: 'ru-owner' },
  ],
  'src-linkedin': [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'страница отвечает 200, но robots.txt содержит Disallow: / — серверный обход исключён',
    },
  ],
  'src-indeed': [
    { items: 0, observedAt: '2026-09-05', route: 'eu-prod', note: '403 честному агенту и из EU' },
  ],
  'src-glassdoor': [
    { items: 0, observedAt: '2026-09-05', route: 'eu-prod', note: '403 честному агенту и из EU' },
  ],
  'src-monster': [
    { items: 0, observedAt: '2026-09-05', route: 'eu-prod', note: '403 честному агенту и из EU' },
  ],
  'src-ziprecruiter': [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'robots.txt: Disallow: / — площадка отказала словами, а не анти-ботом',
    },
  ],
  'src-wellfound': [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: 'страница отдаётся, но поиск вакансий закрыт логином; ленты нет (jobs.rss → редирект)',
    },
  ],
  'src-aijobs': [
    {
      items: 0,
      observedAt: '2026-09-05',
      route: 'eu-prod',
      note: '/feed/, /rss/, /api/jobs/ и /sitemap.xml отдают одну и ту же оболочку SPA в 10 836 байт со всех трёх маршрутов — ленты у сервиса нет по этим адресам',
    },
  ],
};

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
  return MEASUREMENTS[sourceId] ?? ATS_BOARD_MEASUREMENTS[sourceId] ?? [];
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
    enabled: false,
    disabledReason:
      'API Get on Board не отдаёт ни названия компании, ни публичной ссылки на вакансию: `company` приходит ссылкой на идентификатор, `public_url` отсутствует в обеих поверхностях (проверено 2026-08-30, подтверждено 2026-09-05). Карточка без работодателя и без рабочей ссылки — ровно то, что запрещает B161, поэтому источник зарегистрирован, но выключен до отдельного среза с дозапросом компании.',
    targetUrl: 'https://www.getonbrd.com/api/v0/search/jobs?per_page=50',
    requiresQuery: true,
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
    // Адрес отдаёт записи, но своей формы записи продукт пока не разбирает: у
    // каждой JSON-площадки собственный адаптер, и без него сбор упал бы на
    // `vacancy_source_adapter_missing`. Замер живёт в каталоге, подключение —
    // отдельная работа (B199 не подключает новые источники, см. B202).
    enabled: false,
    disabledReason: 'Живой JSON-адрес без адаптера записи; подключение отдельным тикетом',
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
    // См. `src-himalayas-api`: замер есть, адаптера записи нет.
    enabled: false,
    disabledReason: 'Живой JSON-адрес без адаптера записи; подключение отдельным тикетом',
    targetUrl: 'https://www.themuse.com/api/public/jobs?page=1',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'remotive',
    name: 'Remotive (Global Remote)',
    type: 'remotive',
    accessClass: 'api',
    market: 'Удалённо, мир',
    addressStatus: 'robots_forbidden',
    enabled: false,
    disabledReason:
      'robots.txt Remotive запрещает /api именно тому агенту, которым ходит продукт (замер с прод-VM 2026-09-06: User-agent: * → Disallow: /api). Публичный API у площадки задокументирован, но её же robots.txt говорит «не ходи», и слово площадки сильнее нашего удобства — как у ТрудВсем в B199. Возвращается по письменному разрешению площадки.',
    targetUrl: 'https://remotive.com/api/remote-jobs',
    refreshIntervalMinutes: 120,
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
    id: 'src-linkedin',
    name: 'LinkedIn Jobs',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'Мир',
    addressStatus: 'robots_forbidden',
    enabled: false,
    disabledReason:
      'robots.txt LinkedIn содержит Disallow: / — площадка отказала словами, поэтому сервер её не опрашивает никогда. Данные доступны только в браузерной сессии самого кандидата (ADR-009, B206). Владелец 2026-09-05 просил площадку не отсекать — она названа и ждёт своей поверхности.',
    targetUrl: 'https://www.linkedin.com/jobs/search/',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-indeed',
    name: 'Indeed',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'Мир',
    addressStatus: 'needs_browser_session',
    enabled: false,
    disabledReason:
      'Отвечает 403 честному агенту со всех трёх маршрутов (2026-09-05), то есть это защита, а не география. Читается только в браузерной сессии кандидата (B206).',
    targetUrl: 'https://www.indeed.com/jobs',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
  {
    id: 'src-glassdoor',
    name: 'Glassdoor',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'Мир',
    addressStatus: 'needs_browser_session',
    enabled: false,
    disabledReason:
      'Отвечает 403 честному агенту со всех трёх маршрутов (2026-09-05). Читается только в браузерной сессии кандидата (B206).',
    targetUrl: 'https://www.glassdoor.com/Job/index.htm',
    refreshIntervalMinutes: 120,
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
    id: 'src-ziprecruiter',
    name: 'ZipRecruiter',
    type: 'browser_session',
    accessClass: 'browser_session',
    market: 'US',
    addressStatus: 'robots_forbidden',
    enabled: false,
    disabledReason:
      'robots.txt ZipRecruiter содержит Disallow: / — площадка отказала словами, а не анти-ботом (2026-09-05). Сервер её не опрашивает; остаётся браузерная сессия кандидата (B206).',
    targetUrl: 'https://www.ziprecruiter.com/jobs-search',
    refreshIntervalMinutes: 120,
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
];
