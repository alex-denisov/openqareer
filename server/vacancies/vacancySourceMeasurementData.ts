import type { VacancySourceMeasurement } from './defaultVacancySources';

/**
 * What each address actually answered when it was probed. A registry entry
 * without a measurement is a guess, and guesses are what filled the section
 * with sources that could never return anything (B161 review §6, B164).
 *
 * Замеры 2026-09-05 сделаны одним инструментом
 * (`scripts/probe_vacancy_sources.py`, `curl --max-time 45`) с трёх маршрутов
 * подряд; полный отчёт — `docs/v1-release/tasks/evidence/B199-source-probe/`.
 */
export const MEASUREMENTS: Readonly<Record<string, readonly VacancySourceMeasurement[]>> = {
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
    {
      items: 100,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'перепроверка с прод-VM: /api/v0/categories/<id>/jobs открыт и отдаёт links.public_url, но работодатель по-прежнему только числовым company.data.id; /api/v0/companies/<id> отвечает 404 (B216)',
    },
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
      items: 20,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'с прод-VM: totalCount=103 845, курсорная постраничность, не больше 20 на страницу; robots.txt Allow: / (B216)',
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
    {
      items: 20,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'с прод-VM: 22 категории белых воротничков — 215 202 вакансии на 10 761 странице; robots.txt не запрещает /api/public (B216)',
    },
  ],
  'src-amazon-jobs': [
    {
      items: 100,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'search.json с прод-VM: 100 записей на страницу, hits=10000 (потолок площадки); robots.txt запрещает только /internal (B216)',
    },
  ],
  'src-netflix': [
    {
      items: 10,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'Eightfold API с прод-VM: count=488, не больше 10 записей на страницу; robots.txt у jobs.netflix.com нет (B216)',
    },
  ],
  'src-apple-jobs': [
    {
      items: 20,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'POST /api/v1/search с прод-VM без CSRF: totalRecords=6081 по 20 на страницу, 305 страниц; тело обязано нести format; robots.txt у jobs.apple.com — 404 (B217)',
    },
  ],
  'src-microsoft-careers': [
    {
      items: 10,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'apply.careers.microsoft.com/api/pcsx/search (Eightfold) с прод-VM: data.count=2215, не больше 10 на страницу; robots.txt этого хоста явно Allow: /api/pcsx. Старый gcsservices.careers.microsoft.com отвечает чужим TLS-сертификатом (B217)',
    },
  ],
  'src-qualcomm-careers': [
    {
      items: 1963,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'careers.qualcomm.com/api/pcsx/search (Eightfold AI) с прод-VM: 1 963 актуальные IT-вакансии',
    },
  ],
  'src-hn-whoishiring': [
    {
      items: 394,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'Hacker News "Who is hiring?" monthly thread (September 2026, story 49522897)',
    },
  ],
  'src-crossover': [
    {
      items: 99,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'sitemap.xml с прод-VM: 102 адреса /jobs/<id>/<brand>/<slug>, 99 уникальных id; описания — Kentico Delivery без ключа (kontent-proxy, тип pipeline, 967 записей, все 99 id найдены); robots открыт. profile-api отвечает 403 без ключа — не используется (B217)',
    },
  ],
  'src-indeed': [
    {
      items: 100,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'apis.indeed.com/graphql с ключом приложения (механика JobSpy) с прод-VM: 100 записей на страницу + nextCursor; indeed.com/robots.txt Allow: / на страницы поиска (B218)',
    },
  ],
  'src-linkedin-guest': [
    {
      items: 10,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'jobs-guest/…/seeMoreJobPostings/search?start=N с прод-VM: 10 карточек на страницу без учётной записи; robots Disallow: /jobs-guest/ — включён по прямому решению владельца (B218)',
    },
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
    {
      items: 16,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'публичный API с прод-VM: job-count=16, задержка 24 ч; юридическая записка в ответе разрешает распространение со ссылкой на Remotive и упоминанием источника, не чаще 4 раз в сутки (B217)',
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
  'src-hh-search': [
    {
      items: 50,
      observedAt: '2026-09-13',
      route: 'eu-prod',
      note: 'страница поиска отдала 50 вакансий и totalResults 1319 по запросу «qa»; без запроса по всей России totalResults 920 303, глубина — 39 страниц по 50',
    },
    {
      items: 50,
      observedAt: '2026-09-13',
      route: 'ru-dc',
      note: 'тот же ответ с московской ноды; капчи в теле нет',
    },
    {
      items: 0,
      observedAt: '2026-09-13',
      route: 'ru-owner',
      note: '451 на весь домен, включая robots.txt — выход рабочей машины владельца площадка не обслуживает',
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
