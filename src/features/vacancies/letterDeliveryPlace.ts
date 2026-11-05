import { isHiringPlatform } from '../../../shared/hiringPlatforms';
import type { LetterDeliveryChannel } from '../../../shared/recruiterChannel';
import type { ConnectionCircleNumber, ConnectionCirclePath } from './vacancyLetterApi';

/** Системы найма: письмо уходит в их форму на странице вакансии. */
const ATS_NAMES: Readonly<Record<string, string>> = {
  'greenhouse.io': 'Greenhouse',
  'lever.co': 'Lever',
  'ashbyhq.com': 'Ashby',
  'myworkdayjobs.com': 'Workday',
  'workday.com': 'Workday',
  'smartrecruiters.com': 'SmartRecruiters',
  'icims.com': 'iCIMS',
  'taleo.net': 'Taleo',
  'successfactors.com': 'SuccessFactors',
  'jobvite.com': 'Jobvite',
  'bamboohr.com': 'BambooHR',
  'recruitee.com': 'Recruitee',
  'workable.com': 'Workable',
  'personio.de': 'Personio',
  'teamtailor.com': 'Teamtailor',
  'breezy.hr': 'Breezy',
  'avature.net': 'Avature',
  'oraclecloud.com': 'Oracle Cloud',
  'eightfold.ai': 'Eightfold',
  'huntflow.ru': 'Huntflow',
  'potok.io': 'Поток',
};

const BOARD_NAMES: Readonly<Record<string, string>> = {
  'linkedin.com': 'LinkedIn',
  'himalayas.app': 'Himalayas',
  'remotive.com': 'Remotive',
  'habr.com': 'Хабр Карьера',
  'superjob.ru': 'SuperJob',
  'getmatch.ru': 'getmatch',
  'trudvsem.ru': 'Работа России',
  'indeed.com': 'Indeed',
  'glassdoor.com': 'Glassdoor',
  'wellfound.com': 'Wellfound',
  'weworkremotely.com': 'We Work Remotely',
  'remoteok.com': 'Remote OK',
  'djinni.co': 'Djinni',
  'rabota.ru': 'Rabota.ru',
  'zarplata.ru': 'Зарплата.ру',
  'avito.ru': 'Авито',
  'geekjob.ru': 'GeekJob',
};

function nameForHost(names: Readonly<Record<string, string>>, host: string): string | null {
  const key = Object.keys(names).find((name) => host === name || host.endsWith(`.${name}`));
  return key ? (names[key] ?? null) : null;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

function placeForWebPage(page: URL): string {
  const host = page.hostname.toLowerCase().replace(/^www\./u, '');
  if (host === 'hh.ru' || host.endsWith('.hh.ru')) return 'hh.ru, отклик на вакансию';
  if (host === 't.me') return `Telegram, t.me/${page.pathname.split('/')[1] ?? ''}`;
  const ats = nameForHost(ATS_NAMES, host);
  if (ats) return `ATS ${ats}`;
  const board = nameForHost(BOARD_NAMES, host);
  if (board) return `${board}, страница вакансии`;
  return isHiringPlatform(host) ? `${host}, страница вакансии` : `сайт компании, ${host}`;
}

/** Куда ведёт адрес вакансии; неизвестное не угадываем. */
export function vacancyDeliveryPlace(url: string): string | null {
  const page = parseUrl(url);
  if (!page) return null;
  if (page.protocol === 'mailto:') return `почта ${page.pathname}`;
  return page.protocol === 'https:' || page.protocol === 'http:' ? placeForWebPage(page) : null;
}

const CHANNEL_NAMES: Readonly<Record<LetterDeliveryChannel['kind'], string>> = {
  email_personal: 'почта',
  email_corporate: 'почта',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
};

interface DeliveryPerson {
  readonly deliveryChannel?: LetterDeliveryChannel | null;
  readonly linkedinUrl?: string | null;
}

/** Подтверждённый канал человека; профиль LinkedIn называем без адреса. */
export function recipientDeliveryPlace(person: DeliveryPerson): string | null {
  const channel = person.deliveryChannel;
  if (channel) {
    const name = CHANNEL_NAMES[channel.kind];
    return channel.kind === 'linkedin' ? name : `${name} ${channel.value}`;
  }
  return person.linkedinUrl ? 'LinkedIn' : null;
}

/** Строка «Кому» макета 9: точное место отправки, а не только название компании. */
export function letterRecipientTitle(
  circle: ConnectionCircleNumber,
  path: Pick<ConnectionCirclePath, 'path' | 'recipient'>,
  name: string,
  vacancyUrl: string,
): string {
  const person = circle === 2 ? (path.path[1] ?? path.recipient) : path.recipient;
  const place =
    recipientDeliveryPlace(person) ?? (circle === 3 ? vacancyDeliveryPlace(vacancyUrl) : null);
  // Адресата-человека нет: вместо него в строке стоит сам канал.
  if (path.recipient.id.startsWith('vacancy:')) {
    return `Кому: ${place ?? `${name}, канал отправки не указан в вакансии`}`;
  }
  return `${circle === 2 ? 'Через кого' : 'Кому'}: ${name}, ${place ?? 'канал не указан'}`;
}
