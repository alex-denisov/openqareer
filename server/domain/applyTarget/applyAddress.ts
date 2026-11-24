import type { ApplyChannel } from '../../../shared/applyTarget';
import { hhVacancyIdFromUrl } from '../../../shared/hhCandidateSession';

export interface ApplyAddress {
  readonly channel: ApplyChannel;
  readonly url: string;
  readonly formUrl: string;
  readonly email?: string;
}

/** Адрес длиннее — мусор, а не ссылка на вакансию. */
const URL_MAX_LENGTH = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Площадки вакансий: отклик идёт через них, это не сайт работодателя. */
const BOARD_HOSTS: readonly string[] = [
  'himalayas.app',
  'getmatch.ru',
  'career.habr.com',
  'news.ycombinator.com',
  'themuse.com',
  'getonbrd.com',
  'remotive.com',
  'weworkremotely.com',
  'remoteok.com',
  'remoteok.io',
  'nodesk.co',
  'jobicy.com',
  'arbeitnow.com',
  'jobs.dou.ua',
  'djinni.co',
  'workingnomads.com',
  'trudvsem.ru',
  'superjob.ru',
  'rabota.ru',
  'zarplata.ru',
  'glassdoor.com',
  'ziprecruiter.com',
  'wellfound.com',
  'ycombinator.com',
  'workatastartup.com',
  'landing.jobs',
  'justjoin.it',
  'nofluffjobs.com',
];

/** Трекеры: адрес сам не форма, а переход на неё. Только их сервер вправе открыть. */
const TRACKER_HOSTS: readonly string[] = ['grnh.se', 'appcast.io', 'recruitics.com', 'jometer.com'];

/** Параметры, в которых переходник несёт конечный адрес. */
const REDIRECT_PARAMS: readonly string[] = [
  'url',
  'u',
  'dest',
  'destination',
  'redirect',
  'redirect_url',
  'redirecturl',
  'target',
  'r',
  'job_url',
  'joburl',
  'rx_url',
];

/** Трекер адреса без поддомена: лимит обращений общий на площадку. */
export function trackerHost(value: string): string | undefined {
  const host = parseHttpUrl(value)?.hostname ?? '';
  return TRACKER_HOSTS.find((base) => isHost(host, base));
}

const isHost = (host: string, base: string) => host === base || host.endsWith(`.${base}`);
const inHosts = (host: string, bases: readonly string[]) =>
  bases.some((base) => isHost(host, base));

export function parseHttpUrl(value: string | undefined): URL | null {
  if (!value || value.length > URL_MAX_LENGTH || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.username || url.password ? null : url;
}

/** Трекер, чей адрес можно раскрыть переходом: https, обычный порт, известный хост. */
export function isTrackerUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return Boolean(
    url && url.protocol === 'https:' && !url.port && inHosts(url.hostname, TRACKER_HOSTS),
  );
}

type Rule = (url: URL, parts: readonly string[]) => ApplyAddress | null;

const address = (channel: ApplyChannel, url: string, formUrl = url): ApplyAddress => ({
  channel,
  url,
  formUrl,
});

/** Форма Greenhouse по доске и номеру: открывается и у работодателей со встроенной доской. */
export function greenhouseAddress(
  board: string,
  jobId: string,
  host = 'job-boards.greenhouse.io',
): ApplyAddress {
  const url = `https://${host}/embed/job_app?for=${encodeURIComponent(board)}&token=${jobId}`;
  return address('greenhouse', url);
}

const greenhouse: Rule = (url, parts) => {
  if (!/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/u.test(url.hostname)) return null;
  const board = url.searchParams.get('for');
  const token = url.searchParams.get('token');
  if (parts[0] === 'embed') {
    return board && /^\d{1,20}$/u.test(token ?? '')
      ? greenhouseAddress(board, token!, url.hostname)
      : null;
  }
  if (parts[1] !== 'jobs' || !/^\d{1,20}$/u.test(parts[2] ?? '')) return null;
  return address('greenhouse', `https://${url.hostname}/${parts[0]}/jobs/${parts[2]}`);
};

/** Доска Ashby и Lever: `/<компания>/<uuid>`; форма — отдельный адрес. */
const uuidBoard =
  (channel: ApplyChannel, hosts: RegExp, form: string): Rule =>
  (url, parts) => {
    if (!hosts.test(url.hostname) || !parts[0] || !UUID.test(parts[1] ?? '')) return null;
    const posting = `https://${url.hostname}/${parts[0]}/${parts[1]}`;
    return address(channel, posting, `${posting}/${form}`);
  };

/** ATS с поддоменом работодателя: адрес вакансии по образцу пути, форма — с окончанием. */
const tenant =
  (channel: ApplyChannel, hosts: RegExp, path: RegExp, form = ''): Rule =>
  (url) => {
    const match = hosts.test(url.hostname) ? path.exec(url.pathname) : null;
    if (!match) return null;
    const posting = `https://${url.hostname}${match[1]}`;
    return address(channel, posting, posting + form);
  };

const RULES: readonly Rule[] = [
  (url) => {
    const id = hhVacancyIdFromUrl(`https://${url.hostname}${url.pathname}`);
    return id ? address('hh', `https://hh.ru/vacancy/${id}`) : null;
  },
  (url) => {
    const id =
      isHost(url.hostname, 'linkedin.com') &&
      /^\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/u.exec(url.pathname);
    return id ? address('linkedin', `https://www.linkedin.com/jobs/view/${id[1]}`) : null;
  },
  greenhouse,
  uuidBoard('ashby', /^jobs\.ashbyhq\.com$/u, 'application'),
  uuidBoard('lever', /^jobs\.(?:eu\.)?lever\.co$/u, 'apply'),
  tenant('recruitee', /\.recruitee\.com$/u, /^((?:\/[a-z]{2})?\/o\/[^/]+)/u, '/c/new'),
  tenant(
    'teamtailor',
    /\.teamtailor\.com$/u,
    /^((?:\/[a-z-]{2,5})?\/jobs\/\d+[^/]*)/u,
    '/applications/new',
  ),
  tenant('personio', /\.jobs\.personio\.(?:de|com)$/u, /^(\/job\/\d+)/u),
  tenant('breezy', /\.breezy\.hr$/u, /^(\/p\/[^/]+)/u, '/apply'),
  tenant('bamboohr', /\.bamboohr\.com$/u, /^(\/(?:careers|jobs)\/\d+)/u),
  tenant('workable', /^apply\.workable\.com$/u, /^((?:\/[^/]+)?\/j\/[A-Z0-9]+)/u, '/apply/'),
  tenant('smartrecruiters', /^jobs\.smartrecruiters\.com$/u, /^(\/[^/]+\/\d{6,}[^/]*)/u),
  tenant('oracle', /\.oraclecloud\.com$/u, /^(\/hcmUI\/CandidateExperience\/.*\/job\/[^/]+)/u),
  tenant('workday', /\.(?:myworkdayjobs|myworkdaysite)\.com$/u, /^(\/.*\/job\/.+)/u),
  tenant('icims', /\.icims\.com$/u, /^(\/jobs\/\d+(?:\/[^/]+)?\/job)/u),
];

/** Адрес вакансии на узнанной площадке; иначе `null`. */
function knownAddress(url: URL): ApplyAddress | null {
  const parts = url.pathname.split('/').filter(Boolean);
  for (const rule of RULES) {
    const found = rule(url, parts);
    if (found) return found;
  }
  return null;
}

/** Конечный адрес, который переходник несёт в параметре. */
function nestedUrl(url: URL): URL | null {
  for (const [name, value] of url.searchParams) {
    if (!REDIRECT_PARAMS.includes(name.toLowerCase())) continue;
    const nested = parseHttpUrl(value);
    if (nested && nested.hostname !== url.hostname) return nested;
  }
  return null;
}

/** Узнанная ATS в самом адресе или в адресе, вложенном в параметр. Сеть не нужна. */
export function atsAddress(value: string | undefined): ApplyAddress | null {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const own = knownAddress(url);
  if (own) return own;
  const nested = nestedUrl(url);
  if (!nested) return null;
  const known = knownAddress(nested);
  // Незнакомый вложенный адрес — цель, только когда внешний точно трекер.
  return known ?? (isTrackerUrl(url.href) ? address(plainChannel(nested), nested.href) : null);
}

function plainChannel(url: URL): ApplyChannel {
  if (url.hostname === 't.me') return 'telegram';
  if (/(?:^|\.)indeed\.[a-z.]{2,6}$/u.test(url.hostname)) return 'indeed';
  if (isHost(url.hostname, 'linkedin.com')) return 'linkedin';
  if (isHost(url.hostname, 'hh.ru')) return 'hh';
  return inHosts(url.hostname, BOARD_HOSTS) ? 'board' : 'site';
}

/** Любой адрес вакансии: узнанная ATS, площадка или сайт работодателя. */
export function applyAddress(value: string | undefined): ApplyAddress | null {
  const known = atsAddress(value);
  if (known) return known;
  const url = parseHttpUrl(value);
  return url ? address(plainChannel(url), url.href) : null;
}

/** Канал работодателя: его ATS или сайт, а не площадка вакансий. */
export function isEmployerChannel(channel: ApplyChannel): boolean {
  return !['hh', 'linkedin', 'indeed', 'board', 'telegram', 'email', 'site'].includes(channel);
}
