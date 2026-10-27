/**
 * Хосты систем найма и площадок вакансий: их домен — не домен компании,
 * и почта на нём не может быть почтой рекрутёра.
 */
export const HIRING_PLATFORM_HOSTS = [
  'contacthr.com', 'myworkdayjobs.com', 'workday.com', 'greenhouse.io', 'lever.co',
  'smartrecruiters.com', 'ashbyhq.com', 'icims.com', 'taleo.net', 'successfactors.com',
  'jobvite.com', 'bamboohr.com', 'recruitee.com', 'workable.com', 'personio.de',
  'teamtailor.com', 'breezy.hr', 'themuse.com', 'indeed.com', 'glassdoor.com',
  'hh.ru', 'headhunter.ru', 'linkedin.com', 'remotive.com', 'habr.com', 'superjob.ru',
  'github.com', 't.me', 'huntflow.ru', 'potok.io', 'getmatch.ru', 'trudvsem.ru',
  'himalayas.app', 'avature.net', 'oraclecloud.com', 'eightfold.ai', 'jobs2web.com',
  'wellfound.com', 'angel.co', 'builtin.com', 'dice.com', 'ziprecruiter.com', 'monster.com',
  'simplyhired.com', 'jooble.org', 'adzuna.com', 'otta.com', 'welcometothejungle.com',
  'weworkremotely.com', 'remoteok.com', 'careerjet.com', 'djinni.co', 'rabota.ru',
  'zarplata.ru', 'avito.ru', 'geekjob.ru',
] as const;

export function isHiringPlatform(host: string): boolean {
  const name = host.toLowerCase().replace(/^www\./u, '');
  return HIRING_PLATFORM_HOSTS.some((platform) => name === platform || name.endsWith(`.${platform}`));
}
