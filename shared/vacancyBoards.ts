/** Площадки вакансий: отклик идёт через них, это не сайт работодателя. */
export const VACANCY_BOARDS: ReadonlyMap<string, string> = new Map([
  ['himalayas.app', 'Himalayas'],
  ['getmatch.ru', 'Getmatch'],
  ['career.habr.com', 'Хабр Карьера'],
  ['news.ycombinator.com', 'Hacker News'],
  ['themuse.com', 'The Muse'],
  ['getonbrd.com', 'Get on Board'],
  ['remotive.com', 'Remotive'],
  ['weworkremotely.com', 'We Work Remotely'],
  ['remoteok.com', 'Remote OK'],
  ['remoteok.io', 'Remote OK'],
  ['nodesk.co', 'NoDesk'],
  ['jobicy.com', 'Jobicy'],
  ['arbeitnow.com', 'Arbeitnow'],
  ['jobs.dou.ua', 'DOU'],
  ['djinni.co', 'Djinni'],
  ['workingnomads.com', 'Working Nomads'],
  ['trudvsem.ru', 'ТрудВсем'],
  ['superjob.ru', 'SuperJob'],
  ['rabota.ru', 'Rabota.ru'],
  ['zarplata.ru', 'Zarplata.ru'],
  ['glassdoor.com', 'Glassdoor'],
  ['ziprecruiter.com', 'ZipRecruiter'],
  ['wellfound.com', 'Wellfound'],
  ['ycombinator.com', 'Y Combinator'],
  ['workatastartup.com', 'Work at a Startup'],
  ['landing.jobs', 'Landing.jobs'],
  ['justjoin.it', 'Just Join IT'],
  ['nofluffjobs.com', 'No Fluff Jobs'],
]);

/** Имя площадки по хосту ссылки; `null` — это не площадка вакансий. */
export function vacancyBoardName(hostname: string): string | null {
  const host = hostname.toLowerCase();
  const labels = host.split('.');
  for (let from = 0; from < labels.length - 1; from += 1) {
    const name = VACANCY_BOARDS.get(labels.slice(from).join('.'));
    if (name) return name;
  }
  return null;
}
