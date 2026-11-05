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
  'src-yc-work-at-startup': [
    {
      items: 138,
      observedAt: '2026-09-21',
      route: 'eu-prod',
      note: 'Пять публичных role pages с production VM: jobs, product, recruiting/HR, sales и operations; robots Allow: /. Включён только для bounded source wave по решению владельца.',
    },
  ],
  'src-epam': [
    {
      items: 4111,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Открытый REST API careers.epam.com/api/jobs/v2/search/careers-i18n с заголовком Referer. 4111 активных вакансий прямого работодателя.',
    },
  ],
  'src-playrix': [
    {
      items: 29,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'POST https://playrix.com/api/v1/index.php?action=job/getList. 29 активных вакансий прямого работодателя.',
    },
  ],
  'src-preply': [
    {
      items: 117,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Next.js pageProps.jobs на preply.com/en/careers. 117 активных вакансий прямого работодателя.',
    },
  ],
  'src-kaspersky': [
    {
      items: 13,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'HTML портал careers.kaspersky.com/vacancies. 13 активных вакансий прямого работодателя.',
    },
  ],
  'src-veeam': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'HTML каталог careers.veeam.com/vacancies. 3 активных вакансий прямого работодателя.',
    },
  ],
  'src-linkedin-ringcentral': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=60868. 10 активных вакансий RingCentral на первой странице.',
    },
  ],
  'src-linkedin-cloudlinux': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=632769. 5 активных вакансий CloudLinux.',
    },
  ],
  'src-linkedin-ciklum': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=9183. 6 активных вакансий Ciklum.',
    },
  ],
  'src-linkedin-astound-commerce': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=2403308. 3 активных вакансий Astound Commerce.',
    },
  ],
  'src-linkedin-indrive': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=11847304. 2 активных вакансий inDrive.',
    },
  ],
  'src-linkedin-wallarm': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LinkedIn Guest API search?f_C=4871419. 1 активная вакансия Wallarm (Demand Generation Manager).',
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
  'src-linkedin-crawler': [
    {
      items: 25,
      observedAt: '2026-09-16',
      route: 'eu-prod',
      note: 'LinkedIn Obscura stealth scraper & account pool (B208): 25 актуальных вакансий',
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
  'src-tg-opento-cyprus': [
    { items: 19, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-young-relocate': [
    { items: 19, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-youritjob': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-relocats': [
    { items: 15, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-svoijobs': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-rabotavserbii': [
    { items: 12, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-remote-jobs-relocate': [
    { items: 12, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-kudavalera': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-evacuatejobs': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-remotejobss': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-relocateme': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-israjobs': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-gdjobs': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-gamedevjobs': [
    { items: 19, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-devjobs': [
    { items: 19, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-it-vakansii-udalenka': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-young-june': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-young-gamedev': [
    { items: 18, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-young-intern': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-yuniorapp': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-python-work1': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-ingamejob-art': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-designer-ru': [
    { items: 17, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-dartlang-jobs': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tg-jvmjobs': [
    { items: 15, observedAt: '2026-11-04', route: 'eu-prod' },
  ],
  'src-tradingview': [
    { items: 20, observedAt: '2026-11-04', route: 'eu-prod' },
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
    {
      items: 30,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'glassdoor.com/graph (GraphQL JobSearchResultsQuery с Obscura stealth): 30 актуальных вакансий',
    },
  ],
  'src-bayt': [
    {
      items: 25,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'bayt.com/en/international/jobs (HTML scraper с Obscura stealth): 25 актуальных вакансий',
    },
  ],
  'src-monster': [
    { items: 0, observedAt: '2026-09-05', route: 'eu-prod', note: '403 честному агенту и из EU' },
  ],
  'src-naukri': [
    {
      items: 50,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'naukri.com/jobapi/v3/search (механика JobSpy) с прод-VM: 50 актуальных IT-вакансий',
    },
  ],
  'src-bdjobs': [
    {
      items: 45,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'gateway.bdjobs.com/v1/api/jobsearch (механика JobSpy) с прод-VM: 45 актуальных IT-вакансий',
    },
  ],
  'src-ziprecruiter': [
    {
      items: 50,
      observedAt: '2026-09-14',
      route: 'eu-prod',
      note: 'api.ziprecruiter.com/jobs-app/jobs (мобильный API JobSpy) с прод-VM: 50 актуальных IT-вакансий',
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
  'src-3commas': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: '3Commas corporate portal via genericCorporateSiteAdapter. Live sample: \'Agentic AI Engineer\' (https://jobs.ashbyhq.com/3commas/5ad20b42-6b07-4c79-a383-d935a085b660)',
    },
  ],
  'src-8-8allocate-ai': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: '8allocate corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager\' (https://jobs.dou.ua/companies/8allocate/vacancies/357042/)',
    },
  ],
  'src-10web-ai-wordpress': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: '10Web corporate portal via genericCorporateSiteAdapter. Live sample: \'Applied Scientist\' (https://builtin.com/job/applied-scientist/11710973)',
    },
  ],
  'src-a-agileengine-ai': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'AgileEngine corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Product Manager ID98798\' (https://jobs.dou.ua/companies/agileengine/vacancies/378810/)',
    },
  ],
  'src-a-altoros': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Altoros corporate portal via genericCorporateSiteAdapter. Live sample: \'(803) Senior Python Developer - L3 Support (SRE/Python + Unity-integration)\' (https://apply.workable.com/j/921C452110)',
    },
  ],
  'src-acumatica-erp': [
    {
      items: 28,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Acumatica corporate portal via genericCorporateSiteAdapter. Live sample: \'Intern Developer/ Stagiaire développeur\' (https://jobs.smartrecruiters.com/Acumatica/744000159911799)',
    },
  ],
  'src-acronis-backup': [
    {
      items: 39,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Acronis corporate portal via genericCorporateSiteAdapter. Live sample: \'Product Launch Specialist\' (https://www.acronis.com/en-us/careers/)',
    },
  ],
  'src-accenture': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Accenture corporate portal via genericCorporateSiteAdapter. Live sample: \'Contract Senior Analyst\' (https://accenture.wd103.myworkdayjobs.com/job/Ontario---Ottawa/Contract-Senior-Analyst_R00366210)',
    },
  ],
  'src-agiliway': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Agiliway corporate portal via genericCorporateSiteAdapter. Live sample: \'Admin Support Specialist\' (https://jobs.dou.ua/companies/agiliway/vacancies/378414/)',
    },
  ],
  'src-ai-digital': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'AI corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Coordinator Client Services Entry Level Client Services Entry Level USA (Remote) USA (Remote) Apply now\' (https://www.aidigital.com/vacancies/account-coordinator-3)',
    },
  ],
  'src-ahrefs-seo-marketing-tools': [
    {
      items: 13,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ahrefs corporate portal via genericCorporateSiteAdapter. Live sample: \'Brand Communications Manager\' (https://job-boards.greenhouse.io/ahrefsjobs/jobs/6227789004)',
    },
  ],
  'src-aiby-ai': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'AIBY corporate portal via genericCorporateSiteAdapter. Live sample: \'[object Object]\' (https://aiby.com/jobs/head-of-marketing)',
    },
  ],
  'src-airslate-document-workflow-automation': [
    {
      items: 16,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'airSlate corporate portal via genericCorporateSiteAdapter. Live sample: \'Analytics Engineering Team Lead\' (https://jobs.lever.co/airslate/420d3150-1983-4032-9170-14e29d8b2fc9)',
    },
  ],
  'src-alpha-affiliates': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ALPHA Affiliates corporate portal via genericCorporateSiteAdapter. Live sample: \'General\' (https://careers.skailer.com/alphaaffiliates/jobs/2I2CC5)',
    },
  ],
  'src-ajax-systems-smart-security-iot': [
    {
      items: 186,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ajax Systems corporate portal via genericCorporateSiteAdapter. Live sample: \'Accountant (Settlements with suppliers) ONLY! with Ukrainian/russian language\' (https://jobs.lever.co/ajax/aaaa8edb-94fa-41e9-bdae-d802f25eda9f)',
    },
  ],
  'src-altexsoft': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'AltexSoft corporate portal via genericCorporateSiteAdapter. Live sample: \'Travel Manager\' (https://jobs.dou.ua/companies/altexsoft/vacancies/378356/)',
    },
  ],
  'src-altium': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Altium corporate portal via genericCorporateSiteAdapter. Live sample: \'Growth Marketing Specialist, Acquisition\' (https://jobs.renesas.com/job/growth-marketing-specialist-acquisition-in-lisbon-portugal-jid-7517)',
    },
  ],
  'src-appflame-hily-taimi': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Appflame corporate portal via genericCorporateSiteAdapter. Live sample: \'Customer Support Operations Manager\' (https://job-boards.eu.greenhouse.io/appflame/jobs/5020698101)',
    },
  ],
  'src-avenga': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Avenga corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Visual Artist / Game Designer\' (https://jobs.dou.ua/companies/avenga/vacancies/373793/)',
    },
  ],
  'src-b-binariks': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Binariks corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle Strong QA Engineer (Manual + Automation)\' (https://jobs.dou.ua/companies/binariks/vacancies/378800/)',
    },
  ],
  'src-avride': [
    {
      items: 44,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Avride corporate portal via genericCorporateSiteAdapter. Live sample: \'Autonomous Vehicle Rideshare Driver PM Shifts Only\' (https://job-boards.greenhouse.io/avride/jobs/4163207009)',
    },
  ],
  'src-aviasales-travel-search-ota': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Aviasales Travel search corporate portal via genericCorporateSiteAdapter. Live sample: \'Finance Accountant Accounting\' (https://www.aviasales.com/about/vacancies/4355435)',
    },
  ],
  'src-b-beetroot-edtech': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Beetroot corporate portal via genericCorporateSiteAdapter. Live sample: \'Open vacancies:\' (https://career.beetroot.co/jobs/)',
    },
  ],
  'src-behavox': [
    {
      items: 25,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Behavox corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive, Enterprise\' (https://job-boards.greenhouse.io/behavox/jobs/8285020)',
    },
  ],
  'src-bintime': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Bintime corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/bintime/vacancies/)',
    },
  ],
  'src-betby': [
    {
      items: 15,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'BETBY corporate portal via genericCorporateSiteAdapter. Live sample: \'SENIOR PRODUCT SECURITY ENGINEER\' (https://talent.sage.hr/jobs/686c8be6-688c-4a93-a9fe-996a1052232f)',
    },
  ],
  'src-booking-com-travel-ota': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Booking.com corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior SAP FICA Specialist\' (https://jobs.booking.com/booking/jobs/30644?lang=en-us)',
    },
  ],
  'src-bolt-ride-hailing-mobility': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Bolt Ride-hailing corporate portal via genericCorporateSiteAdapter. Live sample: \'View open roles\' (https://bolt.eu/en/careers/positions/)',
    },
  ],
  'src-boosta-performance': [
    {
      items: 40,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Boosta corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager (Freelance) | Yeep\' (https://job-boards.eu.greenhouse.io/boosta/jobs/5001766101)',
    },
  ],
  'src-brightgrove': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Brightgrove corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior AI Solutions Architect Remote\' (https://careers.brightgrove.com/vacancies/senior-ai-solutions-architect-24622892)',
    },
  ],
  'src-c-chi-software': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Chi corporate portal via genericCorporateSiteAdapter. Live sample: \'Computer Vision Engineer\' (https://jobs.dou.ua/companies/chi-software/vacancies/379087/)',
    },
  ],
  'src-c-cieden-ux-ui': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Cieden UX corporate portal via genericCorporateSiteAdapter. Live sample: \'Lead Generation Manager (Design Agency That Ships)\' (https://jobs.dou.ua/companies/cieden/vacancies/368858/)',
    },
  ],
  'src-c-codeit': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Codeit corporate portal via genericCorporateSiteAdapter. Live sample: \'CTO\' (https://jobs.dou.ua/companies/codeit/vacancies/376108/)',
    },
  ],
  'src-c-teleport': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Teleport corporate portal via genericCorporateSiteAdapter. Live sample: \'Apply for Senior Software Engineer (Remote)\' (https://careers.cteleport.com/jobs/8389390-senior-software-engineer-remote?utm_campaign=jobs-widget&amp;utm_source=careers.cteleport.com&amp;utm_content=jobs&amp;utm_medium=web)',
    },
  ],
  'src-clario-tech-b2c': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Clario Tech corporate portal via genericCorporateSiteAdapter. Live sample: \'Product Manager (Retention &amp; Growth)\' (https://jobs.dou.ua/companies/clario/vacancies/377492/)',
    },
  ],
  'src-chattermill': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Chattermill corporate portal via genericCorporateSiteAdapter. Live sample: \'Global Sales Development Representative\' (https://jobs.ashbyhq.com/chattermill/10ab53ef-57cd-4ee0-8065-32329139da30)',
    },
  ],
  'src-cleveroad': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Cleveroad corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager\' (https://jobs.dou.ua/companies/cleveroad/vacancies/378278/)',
    },
  ],
  'src-creatio-low-code-crm': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Creatio Low-code corporate portal via genericCorporateSiteAdapter. Live sample: \'Technical Product Owner (technical background)\' (https://jobs.dou.ua/companies/creatio/vacancies/374136/)',
    },
  ],
  'src-crowdin-saas': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Crowdin corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/crowdin/vacancies/)',
    },
  ],
  'src-customertimes-it-salesforce': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Customertimes corporate portal via genericCorporateSiteAdapter. Live sample: \'Power Platform &amp; Agentic AI Developer\' (https://jobs.dou.ua/companies/customertimes/vacancies/378601/)',
    },
  ],
  'src-d-diceus': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'DICEUS corporate portal via genericCorporateSiteAdapter. Live sample: \'PR Intern\' (https://jobs.dou.ua/companies/diceus/vacancies/378836/)',
    },
  ],
  'src-d-digital-suits-ux-ui': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Digital Suits UX corporate portal via genericCorporateSiteAdapter. Live sample: \'Manual QA Engineer\' (https://jobs.dou.ua/companies/digitalsuits/vacancies/378362/)',
    },
  ],
  'src-cyberhaven-dlp': [
    {
      items: 32,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Cyberhaven corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Software Engineer (MacOS Endpoint)\' (https://jobs.ashbyhq.com/cyberhaven/23c6f735-13a2-4c4e-a8dc-a95ffd95f57e)',
    },
  ],
  'src-cube-open-source': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Cube corporate portal via genericCorporateSiteAdapter. Live sample: \'Platform Engineer\' (https://cube.dev/jobs/b5cb2a49-881a-4445-880b-09d523f9d4a9)',
    },
  ],
  'src-dataforest-data-ai': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Dataforest Data corporate portal via genericCorporateSiteAdapter. Live sample: \'IT Support Specialist (Junior, 2nd Level) – Hosting (m/w/d)\' (https://dataforest.jobs.personio.de/job/2597712)',
    },
  ],
  'src-darktrace-ai': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Darktrace corporate portal via genericCorporateSiteAdapter. Live sample: \'Technical Success Manager - Enterprise Accounts (France)\' (https://darktrace.wd3.myworkdayjobs.com/job/Paris-Office/Technical-Success-Manager---Enterprise-Accounts--France-_JR102293)',
    },
  ],
  'src-delivery-hero-food-delivery': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Delivery Hero Food delivery corporate portal via genericCorporateSiteAdapter. Live sample: \'Field Operations Supervisor | Zona Sur\' (https://careers.deliveryhero.com/job/field-operations-supervisor-zona-sur-in-buenos-aires-argentina-jid-11714)',
    },
  ],
  'src-datagrail': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'DataGrail corporate portal via genericCorporateSiteAdapter. Live sample: \'IT & Business Systems Manager\' (https://job-boards.greenhouse.io/datagrail/jobs/7980031003)',
    },
  ],
  'src-devcom': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'DevCom corporate portal via genericCorporateSiteAdapter. Live sample: \'System Administrator\' (https://jobs.dou.ua/companies/dev-com/vacancies/378705/)',
    },
  ],
  'src-dev-pro': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Dev.Pro corporate portal via genericCorporateSiteAdapter. Live sample: \'Intermediate Test Engineer\' (https://career.dev.pro/vacancy/5ee42b/)',
    },
  ],
  'src-dinarys-e-commerce': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Dinarys E-commerce corporate portal via genericCorporateSiteAdapter. Live sample: \'Software Engineer (DevOps AWS focused)\' (https://jobs.dou.ua/companies/dinarys/vacancies/378993/)',
    },
  ],
  'src-django-stars-python': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Django Stars corporate portal via genericCorporateSiteAdapter. Live sample: \'/ Remote Senior Full-Stack Engineer Apply for Position\' (https://djangostars.com/vacancy/senior-full-stack-engineer/)',
    },
  ],
  'src-devox-software': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Devox corporate portal via genericCorporateSiteAdapter. Live sample: \'Open DOU\' (https://jobs.dou.ua/companies/devox-software/vacancies/)',
    },
  ],
  'src-doit-software-it-staff-augmentation': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'DOIT Software IT staff augmentation corporate portal via genericCorporateSiteAdapter. Live sample: \'Mobile QA Automation Engineer (Bluetooth/BLE mandatory)\' (https://jobs.dou.ua/companies/doit-software/vacancies/378874/)',
    },
  ],
  'src-easybrain': [
    {
      items: 11,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Easybrain corporate portal via genericCorporateSiteAdapter. Live sample: \'Ads Monetization Manager\' (https://easybrain.com/careers/vacancy/ads-monetization-manager)',
    },
  ],
  'src-edvantis': [
    {
      items: 19,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Edvantis corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Full-Stack Software Engineer (.NET, React)\' (https://jobs.dou.ua/companies/edvantis/vacancies/379002/)',
    },
  ],
  'src-elitex-systems': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Elitex Systems corporate portal via genericCorporateSiteAdapter. Live sample: \'QA Lead: Manual+Automation (EU located)\' (https://jobs.dou.ua/companies/elitex/vacancies/367212/)',
    },
  ],
  'src-eleks-it-services-r-d-outsourcing': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ELEKS IT services corporate portal via genericCorporateSiteAdapter. Live sample: \'All Vacancies\' (https://careers.eleks.com/vacancies/)',
    },
  ],
  'src-emcd': [
    {
      items: 14,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'EMCD corporate portal via genericCorporateSiteAdapter. Live sample: \'Talent Pool\' (https://www.careers-page.com/emcd/job/LR8W8V96)',
    },
  ],
  'src-emerging-travel-group-ota-travel-tech-ratehawk-ostrovok': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Emerging Travel Group OTA corporate portal via genericCorporateSiteAdapter. Live sample: \'Go beyond frontiers\' (https://www.emergingtravel.com/career/positions/)',
    },
  ],
  'src-esputnik-yespo-cdp-email': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'eSputnik CDP corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/esputnik/vacancies/)',
    },
  ],
  'src-everstake': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Everstake corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Business Development Manager US\' (https://everstake.one/careers)',
    },
  ],
  'src-exante-brokerage-trading-platform': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'EXANTE Brokerage corporate portal via genericCorporateSiteAdapter. Live sample: \'Search jobs\' (https://careers.exante.eu/jobs/)',
    },
  ],
  'src-exoft-euvic': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Exoft corporate portal via genericCorporateSiteAdapter. Live sample: \'Бухгалтер / Finance &amp; Accounting Specialist\' (https://jobs.dou.ua/companies/exoft/vacancies/376267/)',
    },
  ],
  'src-f-futurra-group-consumer': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Futurra Group corporate portal via genericCorporateSiteAdapter. Live sample: \'Full-stack Developer (Programmatic SEO)\' (https://jobs.dou.ua/companies/futurra-group/vacancies/378660/)',
    },
  ],
  'src-f-fondy': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Fondy corporate portal via genericCorporateSiteAdapter. Live sample: \'Join our team\' (https://fondy.io/gb/careers/vacancies/)',
    },
  ],
  'src-freedom24': [
    {
      items: 46,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Freedom24 corporate portal via genericCorporateSiteAdapter. Live sample: \'AML Officer\' (https://apply.workable.com/j/83E4D7A0B9)',
    },
  ],
  'src-gaijin-entertainment-war-thunder': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Gaijin Entertainment corporate portal via genericCorporateSiteAdapter. Live sample: \'Business development manager Business Development\' (https://gaijinent.com/job/business-development-manager)',
    },
  ],
  'src-geniusee': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Geniusee corporate portal via genericCorporateSiteAdapter. Live sample: \'Principal AI Solution Architect (Agentic Development Lifecycle)\' (https://jobs.dou.ua/companies/geniusee/vacancies/378703/)',
    },
  ],
  'src-gitlab-devsecops-git-platform': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'GitLab DevSecOps corporate portal via genericCorporateSiteAdapter. Live sample: \'See open positions\' (https://about.gitlab.com/jobs/all-jobs/)',
    },
  ],
  'src-gismart': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Gismart corporate portal via genericCorporateSiteAdapter. Live sample: \'Marketing Analyst (FitMe)\' (https://jobs.ashbyhq.com/gismart/836970cf-9bc7-4f1b-bbea-0765e778944d)',
    },
  ],
  'src-grab-ride-hailing-super-app-sea': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Grab Ride-hailing corporate portal via genericCorporateSiteAdapter. Live sample: \'0 Your Saved Jobs\' (https://www.grab.careers/en/jobs/saved-jobs/)',
    },
  ],
  'src-halo-lab-ux-ui': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Halo Lab UX corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Product Designer\' (https://jobs.dou.ua/companies/halo-lab/vacancies/375821/)',
    },
  ],
  'src-headway-edtech': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Headway EdTech corporate portal via genericCorporateSiteAdapter. Live sample: \'Investment Associate\' (https://careers.headway.inc/jobs/8659413-investment-associate)',
    },
  ],
  'src-holywater-my-drama': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Holywater corporate portal via genericCorporateSiteAdapter. Live sample: \'User Acquisition Manager (Middle/Senior)\' (https://jobs.ashbyhq.com/holywater/e071effe-ef12-4443-988c-527482fd1941)',
    },
  ],
  'src-higgsfield-ai': [
    {
      items: 95,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Higgsfield corporate portal via genericCorporateSiteAdapter. Live sample: \'Content Editor\' (https://jobs.ashbyhq.com/higgsfieldai/b9720c4e-23a6-4a59-bb1e-745986cf4ac2)',
    },
  ],
  'src-humansignal': [
    {
      items: 56,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'HumanSignal corporate portal via genericCorporateSiteAdapter. Live sample: \'AI Trainer - Automotive Expertise Required\' (https://job-boards.greenhouse.io/humansignal/jobs/6006505004)',
    },
  ],
  'src-influ2-abm-adtech': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Influ2 corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Business Analyst/BI Engineer\' (https://jobs.smartrecruiters.com/Influ2/743999834235830)',
    },
  ],
  'src-incode': [
    {
      items: 13,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Incode corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive\' (https://job-boards.greenhouse.io/incode/jobs/6231218004)',
    },
  ],
  'src-innovecs-software-engineering': [
    {
      items: 14,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Innovecs Software engineering corporate portal via genericCorporateSiteAdapter. Live sample: \'JOIN INNOVECS\' (https://innovecs.com/vacancies/)',
    },
  ],
  'src-inoxoft': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Inoxoft corporate portal via genericCorporateSiteAdapter. Live sample: \'Бухгалтер / Accountant\' (https://jobs.dou.ua/companies/inoxoft/vacancies/379001/)',
    },
  ],
  'src-intellias-it-services-product-engineering': [
    {
      items: 31,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Intellias IT services corporate portal via genericCorporateSiteAdapter. Live sample: \'All vacancies\' (https://career.intellias.com/vacancies/)',
    },
  ],
  'src-intetics-qa': [
    {
      items: 211,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Intetics corporate portal via genericCorporateSiteAdapter. Live sample: \'.Net/C# Developer (Short term)\' (https://apply.workable.com/j/3E6E8A0EB8)',
    },
  ],
  'src-inworld-ai-ai': [
    {
      items: 17,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Inworld corporate portal via genericCorporateSiteAdapter. Live sample: \'Staff / Principal Research Scientist, Models - USA\' (https://jobs.ashbyhq.com/inworld-ai/abb10a5c-cc22-4b18-892d-aea354c6bfdc)',
    },
  ],
  'src-investengine': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'InvestEngine corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle Backend Engineer, Pensions & Transfer Team (Python)\' (https://careers.investengine.com/jobs/8662989-middle-backend-engineer-pensions-transfer-team-python)',
    },
  ],
  'src-jelvix': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Jelvix corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/jelvix/vacancies/)',
    },
  ],
  'src-jappware': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Jappware corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Backend Engineer\' (https://jobs.dou.ua/companies/jappware/vacancies/371547/)',
    },
  ],
  'src-jooble-job-search': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Jooble Job search corporate portal via genericCorporateSiteAdapter. Live sample: \'Creative Marketing Specialist\' (https://careers.jooble.com/jobs/8659454-creative-marketing-specialist)',
    },
  ],
  'src-jettycloud': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'JettyCloud corporate portal via genericCorporateSiteAdapter. Live sample: \'Site Reliability Engineer (Telco team)\' (https://www.jettycloud.com/vacancies/site-reliability-engineer-telco-team)',
    },
  ],
  'src-jetbrains': [
    {
      items: 34,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'JetBrains corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager (B2B Segment - Global Accounts without KAM coverage)\' (https://job-boards.eu.greenhouse.io/jetbrains/jobs/4753222101)',
    },
  ],
  'src-k-kindgeek': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Kindgeek corporate portal via genericCorporateSiteAdapter. Live sample: \'Content Producer\' (https://jobs.dou.ua/companies/kindgeek/vacancies/374459/)',
    },
  ],
  'src-kitrum': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Kitrum corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/kitrum/vacancies/)',
    },
  ],
  'src-kevuru-games': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Kevuru corporate portal via genericCorporateSiteAdapter. Live sample: \'SEO Specialist\' (https://jobs.dou.ua/companies/kevurugames/vacancies/354234/)',
    },
  ],
  'src-kultprosvet-r-d': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Kultprosvet corporate portal via genericCorporateSiteAdapter. Live sample: \'Team Lead (Team Management Experience Required)\' (https://jobs.dou.ua/companies/kultprosvet/vacancies/378697/)',
    },
  ],
  'src-krisp-ai': [
    {
      items: 18,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Krisp corporate portal via genericCorporateSiteAdapter. Live sample: \'Enterprise ABM Lead Marketing US, Remote\' (https://krisp.ai/jobs/enterprise-abm-lead/)',
    },
  ],
  'src-l-leverx-sap-it': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'LeverX corporate portal via genericCorporateSiteAdapter. Live sample: \'SAP Analytics Cloud Consultant (with Polish)\' (https://career.leverx.com/vacancies/sap-analytics-cloud-consultant)',
    },
  ],
  'src-lemberg-solutions-iot-ai': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Lemberg Solutions IoT corporate portal via genericCorporateSiteAdapter. Live sample: \'Менеджер з адміністративно-господарської діяльності\' (https://jobs.dou.ua/companies/lemberg-solutions/vacancies/378818/)',
    },
  ],
  'src-lemon-io': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Lemon.io corporate portal via genericCorporateSiteAdapter. Live sample: \'Head of Engineering\' (https://jobs.ashbyhq.com/lemon-io/4dc7dd66-686c-4a07-82cc-a1a8448d34c6)',
    },
  ],
  'src-liki24-e-commerce': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Liki24 corporate portal via genericCorporateSiteAdapter. Live sample: \'Merchant Account Manager\' (https://jobs.dou.ua/companies/liki24/vacancies/378776/)',
    },
  ],
  'src-let-s-enhance-claid-ai-ai-image-enhancement': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Let\'s Enhance / Claid.ai AI image enhancement corporate portal via genericCorporateSiteAdapter. Live sample: \'UGC Creator (remote/part-time)\' (https://careers.letsenhance.io/jobs/4590627-ugc-creator-remote-part-time)',
    },
  ],
  'src-manychat': [
    {
      items: 16,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ManyChat corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Python Engineer, Billing & Accounts\' (https://jobs.ashbyhq.com/manychat/b62c092e-c803-4a31-b830-ec45565e0d3d)',
    },
  ],
  'src-luxoft-dxc-it-services-financial-soft': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Luxoft IT services corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Murex Business Analyst (Commodity/FXD)\' (https://career.luxoft.com/jobs/senior-murex-business-analyst-commodityfxd-29049)',
    },
  ],
  'src-luminai': [
    {
      items: 16,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Luminai corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Software Engineer, Product\' (https://jobs.ashbyhq.com/luminai/a84e5f6a-c96c-4571-b2c6-2c724a02a507)',
    },
  ],
  'src-matter-labs-zksync-l2': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Matter corporate portal via genericCorporateSiteAdapter. Live sample: \'Solutions Engineer, Institutional\' (https://jobs.ashbyhq.com/matter-labs/a7b55498-adf4-43d4-a1b6-0c97c8794d76)',
    },
  ],
  'src-mate-academy-it-edtech': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Mate Academy corporate portal via genericCorporateSiteAdapter. Live sample: \'Electronics Hardware Expert (part-time)\' (https://jobs.dou.ua/companies/mate-academy/vacancies/378985/)',
    },
  ],
  'src-mapbox': [
    {
      items: 33,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Mapbox corporate portal via genericCorporateSiteAdapter. Live sample: \'Solutions Architect, Automotive/Enterprise (Korean Speaking)\' (https://jobs.ashbyhq.com/Mapbox/5eed80f2-dceb-4e9b-a355-f4ab3733410e)',
    },
  ],
  'src-mev-iot-ai': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'MEV corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/mev/vacancies/)',
    },
  ],
  'src-mobilunity': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Mobilunity corporate portal via genericCorporateSiteAdapter. Live sample: \'Product Manager (part-time)\' (https://jobs.dou.ua/companies/mobilunity/vacancies/378990/)',
    },
  ],
  'src-mollie-psp': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Mollie corporate portal via genericCorporateSiteAdapter. Live sample: \'Business Development Manager - Denmark Denmark | Remote Go To Market FullTime\' (https://jobs.mollie.com/vacancies/71964e4e-4a86-465d-a800-13baaca08b3c)',
    },
  ],
  'src-movavi': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Movavi corporate portal via genericCorporateSiteAdapter. Live sample: \'DEVOPS TEAM LEAD\' (https://job.movavi.com/vacancies/devops-team-lead/)',
    },
  ],
  'src-monzo': [
    {
      items: 59,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Monzo corporate portal via genericCorporateSiteAdapter. Live sample: \'Android Engineer\' (https://job-boards.greenhouse.io/monzo/jobs/7343996)',
    },
  ],
  'src-n-netpeak-digital-martech-saas': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Netpeak corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle/Senior SEO Specialist (In-house)\' (https://jobs.dou.ua/companies/netpeak/vacancies/377419/)',
    },
  ],
  'src-n-ix-it-services-engineering': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'N-iX IT services corporate portal via genericCorporateSiteAdapter. Live sample: \'Search Jobs\' (https://careers.n-ix.com/jobs/)',
    },
  ],
  'src-nebius-ai-cloud-gpu-compute': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Nebius AI corporate portal via genericCorporateSiteAdapter. Live sample: \'Openings at TripleTen\' (https://www.comeet.com/jobs/tripleten/98.008)',
    },
  ],
  'src-nginx-f5-web-infra-open-source': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'NGINX Web infra corporate portal via genericCorporateSiteAdapter. Live sample: \'Digital Territory Account Manager, Melbourne\' (https://ffive.wd5.myworkdayjobs.com/job/Melbourne/Digital-Territory-Account-Manager--Melbourne_RP1038143)',
    },
  ],
  'src-ocsial': [
    {
      items: 11,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'OCSiAl corporate portal via genericCorporateSiteAdapter. Live sample: \'Sales Manager - Coating\' (https://ocsial.com/careers/vacancies/27c8b-sales-manager-coating)',
    },
  ],
  'src-object-first': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Object First corporate portal via genericCorporateSiteAdapter. Live sample: \'AWS Backend Developer\' (https://job-boards.eu.greenhouse.io/objectfirsts/jobs/4955885101)',
    },
  ],
  'src-osome': [
    {
      items: 8,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Osome corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Product Manager - Intelligence Product · Kuala Lumpur , Indonesia, Singapore · Fully Remote\' (https://careers.osome.com/jobs/8531532-senior-product-manager-intelligence)',
    },
  ],
  'src-outschool': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Outschool corporate portal via genericCorporateSiteAdapter. Live sample: \'Public Funding Operations Manager\' (https://jobs.ashbyhq.com/outschool/28737f02-0594-4143-a66c-c52e9f5fbcac)',
    },
  ],
  'src-p2h': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'P2H corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/p2h/vacancies/)',
    },
  ],
  'src-p-poster-pos-pos-horeca-saas': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Poster corporate portal via genericCorporateSiteAdapter. Live sample: \'PHP Developer\' (https://jobs.dou.ua/companies/poster/vacancies/367496/)',
    },
  ],
  'src-p-plvision': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'PLVision corporate portal via genericCorporateSiteAdapter. Live sample: \'HR Manager (Krakow )\' (https://jobs.dou.ua/companies/plvision/vacancies/378905/)',
    },
  ],
  'src-p-program-ace-xr': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Program-Ace corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/program-ace/vacancies/)',
    },
  ],
  'src-p2p-org-web3': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'P2P.org corporate portal via genericCorporateSiteAdapter. Live sample: \'Join Our Talent Network\' (https://jobs.ashbyhq.com/p2p.org/319dd0be-908f-4ffb-b917-fec0ada67506)',
    },
  ],
  'src-percona-open-source-mysql-postgresql': [
    {
      items: 14,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Percona Open source corporate portal via genericCorporateSiteAdapter. Live sample: \'PostgreSQL Database Support Engineer - EMEA (Remote)\' (https://jobs.ashbyhq.com/percona/99ee2a07-7925-4b8e-9b3c-fb5e43cacc50)',
    },
  ],
  'src-paytm-fintech-payments': [
    {
      items: 201,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Paytm Fintech corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive/ Director - AI Agentic Enterprise Sales\' (https://jobs.lever.co/paytm/9eed4fec-73f7-4114-a5d3-b2f689c92e8c)',
    },
  ],
  'src-pipedrive-crm-sales-pipeline': [
    {
      items: 15,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Pipedrive CRM corporate portal via genericCorporateSiteAdapter. Live sample: \'Berlin\' (https://www.pipedrive.com/en/jobs/berlin)',
    },
  ],
  'src-picsart-creative-tools-photo-ai': [
    {
      items: 7,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'PicsArt Creative tools corporate portal via genericCorporateSiteAdapter. Live sample: \'Growth\' (https://picsart.com/careers/jobs/?department=growth)',
    },
  ],
  'src-plarium-pc-raid': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Plarium corporate portal via genericCorporateSiteAdapter. Live sample: \'External Player Support Agent (Mech Arena)\' (https://jobs.dou.ua/companies/plarium/vacancies/378713/)',
    },
  ],
  'src-playkot': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Playkot corporate portal via genericCorporateSiteAdapter. Live sample: \'Product&GD Growth Producer\' (https://playkot.com/vacancy/growth_producer)',
    },
  ],
  'src-promodo-digital-performance': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Promodo corporate portal via genericCorporateSiteAdapter. Live sample: \'Head of Billing\' (https://jobs.dou.ua/companies/promodo/vacancies/375606/)',
    },
  ],
  'src-provectus-ai': [
    {
      items: 39,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Provectus corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive, AI Consulting\' (https://jobs.lever.co/provectus/161a9cf2-2e85-4a7c-94e0-5dcac2b1d026)',
    },
  ],
  'src-proxet': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Proxet corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Data Scientist\' (https://jobs.dou.ua/companies/proxet/vacancies/378005/)',
    },
  ],
  'src-qarea-qa': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'QArea corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/qarea/vacancies/)',
    },
  ],
  'src-qonto': [
    {
      items: 53,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Qonto corporate portal via genericCorporateSiteAdapter. Live sample: \'Banking Operations Juridical Officer (Germany, Netherlands & Austria)\' (https://jobs.ashbyhq.com/qonto/f2d4e236-7cd0-4372-85d3-b1c705064799)',
    },
  ],
  'src-quintagroup-python': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Quintagroup corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/quintagroup/vacancies/)',
    },
  ],
  'src-quicknode': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'QuickNode corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Software Engineer - Go\' (https://jobs.ashbyhq.com/quicknode/f5d45c23-66d6-47bf-950c-d1ee1b3965da)',
    },
  ],
  'src-razorpay-payments-fintech': [
    {
      items: 26,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Razorpay Payments corporate portal via genericCorporateSiteAdapter. Live sample: \'AI Builder (Senior Product Designer)\' (https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited/jobs/4745511005)',
    },
  ],
  'src-ralabs': [
    {
      items: 16,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ralabs corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Fullstack Python + TypeScript Engineer\' (https://ralabs.org/positions/senior-fullstack-python-typescript-engineer/)',
    },
  ],
  'src-recraft-ai': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Recraft corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior / Staff ML Engineer\' (https://jobs.ashbyhq.com/recraft/676f578f-66f5-4d40-9164-0a3b9cca77cc)',
    },
  ],
  'src-relevant-software': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Relevant corporate portal via genericCorporateSiteAdapter. Live sample: \'Engineering Manager\' (https://jobs.dou.ua/companies/relevant-software/vacancies/378532/)',
    },
  ],
  'src-redwerk': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Redwerk corporate portal via genericCorporateSiteAdapter. Live sample: \'Business Development Manager\' (https://jobs.dou.ua/companies/redwerk/vacancies/361449/)',
    },
  ],
  'src-remofirst': [
    {
      items: 63,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Remofirst corporate portal via genericCorporateSiteAdapter. Live sample: \'Accounts Receivable Manager\' (https://apply.workable.com/j/63CB399914)',
    },
  ],
  'src-ringostat': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ringostat corporate portal via genericCorporateSiteAdapter. Live sample: \'Business Development Manager\' (https://jobs.dou.ua/companies/ringostat/vacancies/378393/)',
    },
  ],
  'src-s-softjourn-fintech-media': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Softjourn Fintech corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle/Middle pro Java Developer\' (https://softjourn.com/careers/vacancies/middle-middle-pro-java-developer-hqzde7m8)',
    },
  ],
  'src-scalable-solutions': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Scalable Solutions corporate portal via genericCorporateSiteAdapter. Live sample: \'C++ developer\' (https://scalablesolutions.io/careers/vacancy/c-plus-plus-developer)',
    },
  ],
  'src-se-ranking-seo-saas': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SE Ranking corporate portal via genericCorporateSiteAdapter. Live sample: \'Send your CV\' (https://seranking.com/vacancies/general-vacancy.html?gh_jid=4063038008)',
    },
  ],
  'src-sendpulse-saas': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SendPulse corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/sendpulse/vacancies/)',
    },
  ],
  'src-semrush-seo-marketing-intelligence': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Semrush corporate portal via genericCorporateSiteAdapter. Live sample: \'Search jobs\' (https://www.semrush.com/jobs/)',
    },
  ],
  'src-servicetitan-saas': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ServiceTitan corporate portal via genericCorporateSiteAdapter. Live sample: \'Strategic Customer Success Manager, Exteriors\' (https://servicetitan.wd1.myworkdayjobs.com/job/US-Remote/Strategic-Customer-Success-Manager--Exteriors_JR116298)',
    },
  ],
  'src-sloboda-studio': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Sloboda Studio corporate portal via genericCorporateSiteAdapter. Live sample: \'Sales Manager (Partnership Manager)\' (https://jobs.dou.ua/companies/sloboda/vacancies/376046/)',
    },
  ],
  'src-skelar-consumer': [
    {
      items: 116,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SKELAR corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior/Lead User Acquisition Manager - Brighterly\' (https://jobs.ashbyhq.com/skelar/5e7c7240-bd39-4a5f-b209-9075f95e7b2d)',
    },
  ],
  'src-singlestore-realtime-sql': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SingleStore Realtime SQL corporate portal via genericCorporateSiteAdapter. Live sample: \'Join us in this mission.\' (https://www.singlestore.com/careers/jobs/)',
    },
  ],
  'src-softswiss-igaming-b2b': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SoftSwiss corporate portal via genericCorporateSiteAdapter. Live sample: \'Job Opportunities\' (https://careers.softswiss.com/vacancies/)',
    },
  ],
  'src-sombra': [
    {
      items: 16,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Sombra corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior UX/UI Designer\' (https://jobs.dou.ua/companies/sombra/vacancies/371856/)',
    },
  ],
  'src-spd-technology': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SPD Technology corporate portal via genericCorporateSiteAdapter. Live sample: \'Applied AI &amp; Machine Learning Engineer\' (https://jobs.dou.ua/companies/spd-technology/vacancies/378604/)',
    },
  ],
  'src-solidgate-payments-fintech': [
    {
      items: 53,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Solidgate Payments corporate portal via genericCorporateSiteAdapter. Live sample: \'Business System Analyst (Tax & Customers)\' (https://jobs.ashbyhq.com/solidgate/06f0463d-272e-407b-ae31-fb9281e9f337)',
    },
  ],
  'src-spotify-music-streaming-audio': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Spotify Music streaming corporate portal via genericCorporateSiteAdapter. Live sample: \'Marketing Lead, Colombia\' (https://www.lifeatspotify.com/jobs/marketing-lead-colombia)',
    },
  ],
  'src-spotware': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Spotware corporate portal via genericCorporateSiteAdapter. Live sample: \'B2B Marketing Lead\' (https://careers.spotware.com/jobs/223354)',
    },
  ],
  'src-stackadapt': [
    {
      items: 68,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Stackadapt corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive\' (https://job-boards.greenhouse.io/stackadapt/jobs/4430615009)',
    },
  ],
  'src-stepico-games-web3': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Stepico corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle/Senior 2D Animator (Contractor)\' (https://jobs.dou.ua/companies/stepico-games/vacancies/377660/)',
    },
  ],
  'src-sumup': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SumUp corporate portal via genericCorporateSiteAdapter. Live sample: \'Loading .css-1ile8z{color:inherit;margin-bottom:0;} Explore open roles\' (https://www.sumup.com/careers/positions/)',
    },
  ],
  'src-supportyourapp': [
    {
      items: 309,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SupportYourApp corporate portal via genericCorporateSiteAdapter. Live sample: \'(English C1) Application Support Specialist (EU, remote)\' (https://apply.workable.com/j/6C01AC49D8)',
    },
  ],
  'src-superannotate-ai': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SuperAnnotate corporate portal via genericCorporateSiteAdapter. Live sample: \'Global Account Director\' (https://jobs.lever.co/superannotate/3c0ebae5-3a26-4f61-9af4-5e8e041441d2)',
    },
  ],
  'src-syndicode': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Syndicode corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Product Designer\' (https://jobs.dou.ua/companies/syndicode/vacancies/377443/)',
    },
  ],
  'src-talentgrator': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Talentgrator corporate portal via genericCorporateSiteAdapter. Live sample: \'Browse Jobs\' (https://talentgrator.com/en/jobs/)',
    },
  ],
  'src-techmagic-healthtech-fintech': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'TechMagic corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle Strong C++ developer (remote)\' (https://jobs.dou.ua/companies/techmagic/vacancies/378035/)',
    },
  ],
  'src-telnyx': [
    {
      items: 63,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Telnyx corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive, ANZ\' (https://job-boards.greenhouse.io/telnyx54/jobs/7647941003)',
    },
  ],
  'src-teleport-zero-trust': [
    {
      items: 21,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Teleport corporate portal via genericCorporateSiteAdapter. Live sample: \'Enterprise Account Development Representative- East Coast\' (https://jobs.ashbyhq.com/goteleport/baaa8f62-a72f-4cb8-b1a6-e1ac6801acfd)',
    },
  ],
  'src-templatemonster': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'TemplateMonster corporate portal via genericCorporateSiteAdapter. Live sample: \'Video Content Creator / Motion Designer, JetMonsters\' (https://jobs.dou.ua/companies/jetmonsters/vacancies/364948/)',
    },
  ],
  'src-termius': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Termius corporate portal via genericCorporateSiteAdapter. Live sample: \'Mobile Tech Lead/ Architect (iOS & Android)\' (https://jobs.lever.co/Termius/9220bcf5-e74b-4c08-b00f-f49b65a9159b)',
    },
  ],
  'src-trinetix-it': [
    {
      items: 30,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Trinetix corporate portal via genericCorporateSiteAdapter. Live sample: \'Careers page test Python Developer\' (https://apply.workable.com/j/03CFF120A8)',
    },
  ],
  'src-trivago-hotel-search-travel': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Trivago Hotel search corporate portal via genericCorporateSiteAdapter. Live sample: \'Show more jobs\' (https://careers.trivago.com/jobs/)',
    },
  ],
  'src-truv': [
    {
      items: 11,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Truv corporate portal via genericCorporateSiteAdapter. Live sample: \'Community & Content Lead\' (https://jobs.lever.co/truv/27f965a7-5808-4243-a0dd-43f7d9f73bb3)',
    },
  ],
  'src-trust-wallet': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Trust Wallet corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Backend Engineer (Go)\' (https://jobs.ashbyhq.com/trust-wallet/f368ed72-a108-47dd-9599-916e20f603d4)',
    },
  ],
  'src-u-universe-group': [
    {
      items: 18,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Universe Group corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Treasury Manager\' (https://jobs.ashbyhq.com/universe/0dd337fa-9a9f-47f6-b5df-f09a66e6ec98)',
    },
  ],
  'src-ucraft-e-commerce': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ucraft corporate portal via genericCorporateSiteAdapter. Live sample: \'View Openings →\' (https://jobs.ucraft.com/jobs/Careers)',
    },
  ],
  'src-u-uipath-rpa': [
    {
      items: 102,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'UiPath RPA corporate portal via genericCorporateSiteAdapter. Live sample: \'Principal Expert, US Insurance Industry\' (https://jobs.ashbyhq.com/uipath/63dd6844-ebf5-401d-89f2-c7533535191d)',
    },
  ],
  'src-unicsoft-helpware': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Unicsoft corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансії\' (https://jobs.dou.ua/companies/unicsoft/vacancies/)',
    },
  ],
  'src-unlimit': [
    {
      items: 52,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Unlimit corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager - Brazil\' (https://jobs.lever.co/unlimit/59b9aa45-daab-46de-a868-2f9a51663702)',
    },
  ],
  'src-uzum': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'uzum corporate portal via genericCorporateSiteAdapter. Live sample: \'Telegram\' (https://t.me/share/url?url=https://people.uzum.com/career/ru/vacancies/3688)',
    },
  ],
  'src-viseven-martech-saas': [
    {
      items: 19,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Viseven MarTech corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Manager (Pharma/MarTech domain)\' (https://jobs.lever.co/viseven/5bb5ae81-4791-4d99-af6e-3ca7caed66a3)',
    },
  ],
  'src-volmi-games-virtuos': [
    {
      items: 5,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Volmi corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Game UX Designer\' (https://jobs.dou.ua/companies/volmi/vacancies/378925/)',
    },
  ],
  'src-volka-games': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'VOLKA corporate portal via genericCorporateSiteAdapter. Live sample: \'Junior Isometric 2D Artist\' (https://jobs.ashbyhq.com/volka/dc636612-2021-437c-93fe-47cda892c367)',
    },
  ],
  'src-vizor-games-social': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Vizor corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior 2D Artist\' (https://vizor-games.com/ru/jobs/senior_2d_artist)',
    },
  ],
  'src-weblium-saas': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Weblium corporate portal via genericCorporateSiteAdapter. Live sample: \'Product Manager\' (https://jobs.dou.ua/companies/weblium/vacancies/370723/)',
    },
  ],
  'src-welltech-wellness': [
    {
      items: 13,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Welltech corporate portal via genericCorporateSiteAdapter. Live sample: \'Total Rewards Specialist\' (https://jobs.ashbyhq.com/welltech/11bc93ba-24d1-4183-8ddd-14d3ac2a9ce8)',
    },
  ],
  'src-wezom': [
    {
      items: 2,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Wezom corporate portal via genericCorporateSiteAdapter. Live sample: \'Junior SEO Specialist\' (https://jobs.dou.ua/companies/wezom/vacancies/369488/)',
    },
  ],
  'src-wise': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Wise corporate portal via genericCorporateSiteAdapter. Live sample: \'Presentation Designer\' (https://wise.jobs/job/presentation-designer-in-london-jid-4469)',
    },
  ],
  'src-wise-international-money-transfers': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Wise International money transfers corporate portal via genericCorporateSiteAdapter. Live sample: \'Presentation Designer\' (https://wise.jobs/job/presentation-designer-in-london-jid-4469)',
    },
  ],
  'src-wrike-project-management': [
    {
      items: 66,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Wrike Project management corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Development Manager 1 -Evening shift (15:30 - 00:00)\' (https://job-boards.greenhouse.io/wrike/jobs/4664056005)',
    },
  ],
  'src-xometry': [
    {
      items: 241,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Xometry corporate portal via genericCorporateSiteAdapter. Live sample: \'Account Executive, ANZ– Manufacturing\' (https://job-boards.greenhouse.io/xometry/jobs/5238553007)',
    },
  ],
  'src-yalantis': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Yalantis corporate portal via genericCorporateSiteAdapter. Live sample: \'Sales Development Representative (German-speaking)\' (https://jobs.dou.ua/companies/yalantis/vacancies/378914/)',
    },
  ],
  'src-yandex': [
    {
      items: 8,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Yandex corporate portal via genericCorporateSiteAdapter. Live sample: \'Development\' (https://yandex.com/jobs/vacancies?professions=backend-developer&amp;professions=database-developer&amp;professions=desktop-developer&amp;professions=frontend-developer&amp;professions=full-stack-developer&amp;professions=ml-developer&amp;professions=mob-app-developer&amp;professions=mob-app-developer-android&amp;professions=mob-app-developer-ios&amp;professions=noc-developer&amp;professions=system-developer)',
    },
  ],
  'src-xsolla': [
    {
      items: 187,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Xsolla corporate portal via genericCorporateSiteAdapter. Live sample: \'(Senior) Android Developer\' (https://jobs.lever.co/xsolla/a90cb94a-df2b-4f42-b60d-8abb68c4bf86)',
    },
  ],
  'src-z-zfort-group-it-ai': [
    {
      items: 4,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zfort Group corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Python Back-End Developer\' (https://jobs.dou.ua/companies/zfort/vacancies/377801/)',
    },
  ],
  'src-zencoder-ai': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zencoder corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Software Engineer\' (https://job-boards.greenhouse.io/zencoder/jobs/4976789007)',
    },
  ],
  'src-zededa': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zededa corporate portal via genericCorporateSiteAdapter. Live sample: \'Financial Planning & Analysis Director\' (https://ats.rippling.com/zededa/jobs/cd070aba-b3d7-4146-b318-b5af99b1e732)',
    },
  ],
  'src-zerion-crypto-wallet-defi': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zerion Crypto wallet corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Backend Engineer\' (https://jobs.lever.co/zerion/d10ab83b-f425-49c2-bc93-09a14e97c2b8)',
    },
  ],
  'src-zone3000-it': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zone3000 corporate portal via genericCorporateSiteAdapter. Live sample: \'Middle + / Senior Mobile iOS Developer in Mobile System Team (#1204)\' (https://jobs.dou.ua/companies/zone3000/vacancies/365331/)',
    },
  ],
  'src-zeroavia': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Zeroavia corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Systems Engineer (IVVQ)\' (https://careers.zeroavia.com/jobs/5a8dfe/senior-systems-engineer-ivvq-kemble-united-kingdom)',
    },
  ],
  'src-ziina': [
    {
      items: 13,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Ziina corporate portal via genericCorporateSiteAdapter. Live sample: \'Backend Engineer, Payments Platform\' (https://jobs.ashbyhq.com/ziina/b52d240f-2ccb-4aea-800b-623e9ca8ae09)',
    },
  ],
  'src-salesforce': [
    {
      items: 1,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Salesforce corporate portal via genericCorporateSiteAdapter. Live sample: \'Search jobs\' (https://www.salesforce.com/company/careers/jobs/)',
    },
  ],
  'src-acca-careers': [
    {
      items: 51,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ACCA Careers corporate portal via genericCorporateSiteAdapter. Live sample: \'Find a job\' (https://jobs.accaglobal.com/jobs/)',
    },
  ],
  'src-intellias': [
    {
      items: 31,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Intellias corporate portal via genericCorporateSiteAdapter. Live sample: \'All vacancies\' (https://career.intellias.com/vacancies/)',
    },
  ],
  'src-ancor': [
    {
      items: 75,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'ANCOR corporate portal via genericCorporateSiteAdapter. Live sample: \'Вакансии\' (https://ancor.ru/vacancy/)',
    },
  ],
  'src-luxoft': [
    {
      items: 6,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Luxoft corporate portal via genericCorporateSiteAdapter. Live sample: \'Senior Murex Business Analyst (Commodity/FXD)\' (https://career.luxoft.com/jobs/senior-murex-business-analyst-commodityfxd-29049)',
    },
  ],
  'src-delivery-hero': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Delivery Hero corporate portal via genericCorporateSiteAdapter. Live sample: \'Field Operations Supervisor | Zona Sur\' (https://careers.deliveryhero.com/job/field-operations-supervisor-zona-sur-in-buenos-aires-argentina-jid-11714)',
    },
  ],
  'src-dxctechnology': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'DXC Technology corporate portal via genericCorporateSiteAdapter. Live sample: \'Technical Support (Miami, FL - ON SITE)\' (https://dxctechnology.wd1.myworkdayjobs.com/job/USA---FL---MIAMI/Technical-Support--Miami--FL---ON-SITE-_51593215)',
    },
  ],
  'src-indrive': [
    {
      items: 10,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'inDrive corporate portal via genericCorporateSiteAdapter. Live sample: \'Explore opportunities\' (https://careers.indrive.com/vacancies/)',
    },
  ],
  'src-softswiss': [
    {
      items: 9,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'SOFTSWISS corporate portal via genericCorporateSiteAdapter. Live sample: \'Job Opportunities\' (https://careers.softswiss.com/vacancies/)',
    },
  ],
  'src-veeam-software': [
    {
      items: 3,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Veeam corporate portal via genericCorporateSiteAdapter. Live sample: \'Director, Sales - Data & AI Security Field Sales London Field Sales\' (https://careers.veeam.com/job/london/director-sales-data-and-ai-security/22681/94080732736)',
    },
  ],
  'src-lbg': [
    {
      items: 20,
      observedAt: '2026-11-05',
      route: 'eu-prod',
      note: 'Lloyds Banking Group corporate portal via genericCorporateSiteAdapter. Live sample: \'Finance Production Assistant\' (https://lbg.wd3.myworkdayjobs.com/job/Bristol/Finance-Production-Assistant_164135-1)',
    },
  ],
};
