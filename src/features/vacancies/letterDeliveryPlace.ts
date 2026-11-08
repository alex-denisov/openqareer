import { isHiringPlatform } from '../../../shared/hiringPlatforms';
import type { LetterDeliveryChannel } from '../../../shared/recruiterChannel';
import { shortPersonName } from './letterPersonChain';
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

/** Канал, через который письмо уйдёт по адресу вакансии; стоит после «через», адресатом не бывает. */
function channelForWebPage(page: URL): string {
  const host = page.hostname.toLowerCase().replace(/^www\./u, '');
  if (host === 'hh.ru' || host.endsWith('.hh.ru')) return 'hh.ru';
  if (host === 't.me') return `Telegram t.me/${page.pathname.split('/')[1] ?? ''}`;
  const ats = nameForHost(ATS_NAMES, host);
  if (ats) return `ATS ${ats}`;
  const board = nameForHost(BOARD_NAMES, host);
  if (board) return board;
  return isHiringPlatform(host) ? host : `сайт компании ${host}`;
}

/** Куда ведёт адрес вакансии; неизвестное не угадываем. */
export function vacancyDeliveryChannel(url: string): string | null {
  const page = parseUrl(url);
  if (!page) return null;
  if (page.protocol === 'mailto:') return `почту ${page.pathname}`;
  return page.protocol === 'https:' || page.protocol === 'http:' ? channelForWebPage(page) : null;
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

/** Тот же канал после «через»: «через почту m@acme.com». */
function recipientDeliveryChannel(person: DeliveryPerson): string | null {
  const place = recipientDeliveryPlace(person);
  return place?.startsWith('почта ') ? `почту ${place.slice('почта '.length)}` : place;
}

/**
 * Строка «Кому» (B618, решение владельца 08.11): адресат — компания или человек в ней, площадка или ATS
 * только канал после «через». Круг 2 «Через кого» остаётся как в макете 9.
 */
export function letterRecipientTitle(
  circle: ConnectionCircleNumber,
  path: Pick<ConnectionCirclePath, 'path' | 'recipient'>,
  name: string,
  vacancyUrl: string,
): string {
  if (circle === 2) {
    const intermediary = path.path[1] ?? path.recipient;
    return `Через кого: ${name}, ${recipientDeliveryPlace(intermediary) ?? 'канал не указан'}`;
  }
  const { recipient } = path;
  const channel =
    recipientDeliveryChannel(recipient) ?? (circle === 3 ? vacancyDeliveryChannel(vacancyUrl) : null);
  const company = recipient.companyName?.trim();
  if (recipient.id.startsWith('vacancy:')) {
    const addressee = company || name;
    return `Кому: ${addressee}, ${channel ? `через ${channel}` : 'канал отправки не указан в вакансии'}`;
  }
  const addressee = [shortPersonName(name), company].filter(Boolean).join(', ');
  return `Кому: ${addressee}, ${channel ? `через ${channel}` : 'канал не указан'}`;
}
