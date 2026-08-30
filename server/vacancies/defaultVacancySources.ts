import type { VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * The three access classes the owner named for B164: what may be read from the
 * open web without hard limits, what has a working official interface, and
 * what exists only inside the candidate's own browser session (ADR-009).
 */
type VacancyAccessClass = 'open_web' | 'api' | 'browser_session';

export interface RegisteredVacancySource extends VacancySourceConfig {
  readonly accessClass: VacancyAccessClass;
  /** Which market the source actually covers, in the owner's region words. */
  readonly market: string;
  /** Required when `enabled` is false: why the product keeps knowing about it. */
  readonly disabledReason?: string;
  /**
   * True when the endpoint answers nothing usable without a search term, so a
   * scheduled query-less sync must skip it rather than record an empty result.
   */
  readonly requiresQuery?: boolean;
}

export interface VacancySourceMeasurement {
  /** What a live request returned, counted from the response body. */
  readonly items: number;
  readonly observedAt: string;
  readonly note?: string;
}

/**
 * What each address actually answered when it was probed. A registry entry
 * without a measurement is a guess, and guesses are what filled the section
 * with sources that could never return anything (B161 review §6, B164).
 *
 * Probed 2026-08-30 from this machine, one request per address.
 */
const MEASUREMENTS: Readonly<Record<string, VacancySourceMeasurement>> = {
  'src-arbeitnow': { items: 175, observedAt: '2026-08-30', note: 'EU / Germany board, one page' },
  'src-remoteok': { items: 101, observedAt: '2026-08-30', note: 'first array element is licence metadata' },
  'src-weworkremotely': { items: 90, observedAt: '2026-08-30', note: 'all categories, not only programming' },
  'src-habr-career': { items: 50, observedAt: '2026-08-30', note: 'honours ?q=' },
  'src-jobicy': { items: 50, observedAt: '2026-08-30' },
  'src-getonbrd': {
    items: 0,
    observedAt: '2026-08-30',
    note: 'LATAM; 50 records come back, but none carries a company name or a public link, so none is usable as a vacancy card',
  },
  'src-workingnomads': { items: 44, observedAt: '2026-08-30' },
  'src-trudvsem': {
    items: 20,
    observedAt: '2026-08-30',
    note: 'Отвечает за ~2 с с клиента на российском маршруте и не отдаёт ответ за 60 с с прод-VM в EU (замерено на самой VM, 31 КБ за 60 с). Пригоден только через российский egress.',
  },
  'src-himalayas': { items: 20, observedAt: '2026-08-30', note: 'atom feed' },
  'remotive': { items: 19, observedAt: '2026-08-30', note: 'whole public feed; ?search= is ignored by the provider' },
  'src-tg-product': { items: 20, observedAt: '2026-08-30' },
  'src-tg-gamedev': { items: 20, observedAt: '2026-08-30' },
  'src-tg-marketing': { items: 20, observedAt: '2026-08-30' },
  'src-tg-react': { items: 20, observedAt: '2026-08-30' },
  'src-tg-datascience': { items: 19, observedAt: '2026-08-30' },
  hh: {
    items: 0,
    observedAt: '2026-08-30',
    note: 'api.hh.ru/vacancies → 403 for an unauthorised search (INC-022, B175)',
  },
  'src-hh-rss': {
    items: 20,
    observedAt: '2026-08-30',
    note: 'hh.ru/search/vacancy/rss?text= answers 200 with 20 items and honours the query',
  },
};

export function vacancySourceMeasurement(sourceId: string): VacancySourceMeasurement | undefined {
  return MEASUREMENTS[sourceId];
}

/**
 * Sources the product knows how to contact.
 *
 * Removed on 2026-08-30 because a live probe proved they can never return
 * anything, and shipping them made the network look wider than it is:
 * `src-superjob` and `src-zarplata` (the export addresses answer HTML and 404),
 * plus eleven Telegram channels whose public web view carries no posts at all
 * (`it_jobs`, `tproger_jobs`, `forphptut`, `devops_jobs`, `qa_jobs`,
 * `relocate_today`, `uiuxjobs`, `ios_jobs`, `golang_jobs`, `python_jobs_feed`,
 * `javajob`). `opendata.trudvsem.ru/vacancies.xml` was a 404; the working
 * official JSON API replaces it.
 */
export const DEFAULT_VACANCY_SOURCES: readonly RegisteredVacancySource[] = [
  {
    id: 'src-trudvsem',
    name: 'Работа в России (ТрудВсем)',
    type: 'json_api',
    accessClass: 'api',
    market: 'Россия',
    // Работает локально и не работает с прод-VM: с самой машины ответ не
    // приходит за 60 с. Держать источник включённым значило бы каждые три часа
    // писать «error» о том, что и так известно (B164, прод-прогон 2026-08-30).
    enabled: false,
    disabledReason:
      'Сервис не отвечает прод-машине в EU: замер с самой VM — 31 КБ за 60 с без завершения, тогда как с российского маршрута ответ приходит за ~2 с. Включить после появления российского egress для источников.',
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
    enabled: false,
    disabledReason:
      'API Get on Board не отдаёт ни названия компании, ни публичной ссылки на вакансию: `company` приходит ссылкой на идентификатор, `public_url` отсутствует в обеих поверхностях (проверено 2026-08-30). Карточка без работодателя и без рабочей ссылки — ровно то, что запрещает B161, поэтому источник зарегистрирован, но выключен до отдельного среза с дозапросом компании.',
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
    enabled: true,
    targetUrl: 'https://himalayas.app/jobs/rss',
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
    enabled: true,
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
    enabled: false,
    disabledReason:
      'Соискательский API hh.ru отвечает 403 без официального доступа партнёра (INC-022). Источник оставлен в реестре, чтобы отказ был назван, а не забыт (B175).',
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
    enabled: false,
    disabledReason:
      'Живая проверка 2026-08-30: hh.ru/search/vacancy/rss?text= отвечает 200, отдаёт 20 вакансий и учитывает запрос. Это другая поверхность, чем закрытый api.hh.ru, но владелец уже принимал решение по доступу к hh.ru (B175) — включение ждёт его прямого ответа, а не решения агента.',
    targetUrl: 'https://hh.ru/search/vacancy/rss',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  },
];
