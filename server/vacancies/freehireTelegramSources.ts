import type { RegisteredVacancySource, VacancySourceMeasurement } from './defaultVacancySources';

/**
 * B646-8: каналы из списка проверенных каналов freehire (migrations/*telegram_channels*,
 * MIT, Copyright (c) 2026 freehire contributors, см. NOTICE). Взяты только те, что
 * 11.11 дали нашему разбору (без модели) не меньше трёх вакансий на последней
 * странице t.me/s и писали за последние 30 дней. Число — замер с маршрута прода.
 */
type Channel = readonly [channel: string, title: string, market: 'ru' | 'intl', items: number];

const CHANNELS: readonly Channel[] = [
  ['careers_crypto', 'CC | Крипто Вакансии', 'ru', 12],
  ['cgrowthcareer', 'C-Growth Career Hub', 'ru', 10],
  ['crypto_vacancy_web3', 'КРИПТО - ВАКАНСИИ | Работа в Web3', 'ru', 14],
  ['cs_algo', '𝗖𝗦 𝗔𝗹𝗴𝗼   𝗖𝗼𝗺𝗽𝗲𝘁𝗶𝘁𝗶𝘃𝗲 𝗣𝗿𝗼𝗴𝗿𝗮𝗺𝗺𝗶𝗻𝗴', 'intl', 19],
  ['cv_2essence', 'Cv2essence', 'intl', 7],
  ['dot_aware', 'DotAware: Off-Campus Tech Jobs', 'intl', 13],
  ['gocareers', 'Go Careers', 'intl', 11],
  ['hireproproduct', 'Hire ProProduct - Продуктовые вакансии', 'ru', 18],
  ['hiringdaily', 'HiringDaily', 'intl', 6],
  ['hrlunapark', 'Take Friends to Luna Park', 'ru', 3],
  ['huggabletalents', 'A-Teams | Карьера', 'ru', 6],
  ['it_interns', 'IT - стажировки и обучение', 'ru', 4],
  ['it_vakansii_jobs', 'СЕТИ — IT & Digital вакансии', 'ru', 4],
  ['job_python', 'Python Job | Вакансии | Стажировки', 'ru', 17],
  ['job_web3', 'Web 3.0 Job | Крипто Вакансии', 'ru', 14],
  ['jobs_juniors_remote', 'Авоська — junior IT вакансии/cтажировки', 'ru', 8],
  ['jobsandinternshipsupdates', 'Jobs and Internships Updates', 'intl', 7],
  ['juniors_rabota_jobs', 'Джуниор Вакансии Стажировки IT', 'ru', 4],
  ['juno_jobs', 'junojobs  стажировки в IT', 'ru', 4],
  ['middle_top_vacancies', 'Вакансии для Миддл и Топ-менеджеров', 'ru', 16],
  ['morejobs', 'Больше джобсов', 'ru', 3],
  ['newdirections', 'New directions: вакансии и стажировки', 'ru', 6],
  ['normrabota', 'Норм работа', 'ru', 10],
  ['off_campus_jobs_and_internships', 'Placement Lelo 2.0', 'intl', 9],
  ['productjobgo', 'Вакансии для продакт-менеджеров', 'ru', 7],
  ['refer_me_it', 'Рефералки в IT | Вакансии и резюме', 'ru', 12],
  ['remotejun', 'Remote Junior (INFLOW)', 'ru', 10],
  ['stemjobscr', 'Ofertas de empleo en STEM para Costa Rica', 'intl', 9],
  ['streltsova_anastasiya', 'Streltsova Anastasiya | GameDev', 'ru', 6],
  ['talentatweb3', 'TalentWeb3', 'intl', 4],
  ['tohire_ng', 'ToHire.NG', 'intl', 7],
  ['torchbearerr', 'TorchBearer(PremiumJobs)', 'intl', 9],
  ['vakansii_it', 'Вакансии айти IT', 'ru', 13],
  ['wantapply_analytics', 'Аналитик за границей - Эксклюзивные вакансии', 'intl', 4],
  ['wantapply_managers', 'PM за границей - Эксклюзивные вакансии для продактов и продж', 'ru', 6],
  ['wantapply_marketing', 'Маркетинг, SMM, PR, Digital вакансии за границей', 'intl', 4],
  ['wantapply_qa_jobs', 'QA Engineer -  вакансии за рубежом', 'ru', 4],
  ['work_for_top', 'КАРЬЕРА ЛИДЕРА | Вакансии для руководителей и топов', 'ru', 7],
  ['workfortop', 'Work For TOP Вакансии для руководителей', 'ru', 5],
  ['worklinketh', 'WorkLink Ethiopia', 'intl', 4],
  ['xcareers', 'xCareers: Digital Jobs - работа, вакансии, фриланс, курсы', 'ru', 14],
  ['zrabota', 'АйТи Вакансии. ИИ Работа. Фриланс. Удаленка', 'ru', 4],
];

const MEASURED_ON = '2026-11-11';

function sourceId(channel: string): string {
  return `src-tg-${channel.toLowerCase().replaceAll('_', '-')}`;
}

export const FREEHIRE_TELEGRAM_SOURCES: readonly RegisteredVacancySource[] = CHANNELS.map(
  ([channel, title, market]) => ({
    id: sourceId(channel),
    name: `Telegram @${channel} (${title})`,
    type: 'telegram',
    accessClass: 'open_web',
    market: market === 'ru' ? 'Россия / СНГ' : 'Международный',
    addressStatus: 'live',
    enabled: true,
    targetUrl: `https://t.me/s/${channel}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  }),
);

export const FREEHIRE_TELEGRAM_MEASUREMENTS: Readonly<
  Record<string, readonly VacancySourceMeasurement[]>
> = Object.fromEntries(
  CHANNELS.map(([channel, , , items]) => [
    sourceId(channel),
    [
      {
        items,
        observedAt: MEASURED_ON,
        route: 'eu-prod' as const,
        note: 'B646-8 последняя страница t.me/s, разбор без модели',
      },
    ],
  ]),
);
