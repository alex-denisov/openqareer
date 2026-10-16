import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type {
  TodayDigest,
  TodayFollowUp,
  TodayNewVacanciesCaption,
  TodayNextInterview,
  TodayQueueItem,
} from './todayApi';
import { pluralRu } from '../../../shared/pluralRu';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

/**
 * Подписи-обоснования под числом на плитке дайджеста (макет
 * B248/today.html): «кампания X · обновлено в 09:14», перечень
 * follow-up-причин, «Компания · раунд N · пятница, 14:00». Вынесено из
 * `TodayScreen.tsx`, чтобы форматирование дат и склейку строк можно было
 * проверить отдельно от вёрстки.
 */

function formatHm(iso: string, timezone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(iso));
}

function formatWeekdayTime(iso: string, timezone?: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
  return `${weekday}, ${formatHm(iso, timezone)}`;
}

export function newVacanciesBasis(
  caption: TodayNewVacanciesCaption | null,
  timezone?: string,
): string | null {
  if (!caption) return null;
  const campaign = caption.campaignRole ? `кампания ${caption.campaignRole}` : null;
  const updated = caption.updatedAt ? `обновлено в ${formatHm(caption.updatedAt, timezone)}` : null;
  return [campaign, updated].filter(Boolean).join(' · ') || null;
}

export function followUpBasis(captions: readonly string[]): string | null {
  return captions.length > 0 ? captions.join(' · ') : null;
}

export function nextInterviewBasis(
  interview: TodayNextInterview | null,
  timezone?: string,
): string | null {
  if (!interview) return null;
  const who = interview.company ?? interview.title;
  return `${who} · раунд ${interview.round} · ${formatWeekdayTime(interview.at, timezone)}`;
}

export function digestBasis(
  kind: 'new' | 'followUp' | 'interview',
  digest: TodayDigest,
  timezone?: string,
): string | null {
  if (kind === 'new') return newVacanciesBasis(digest.newVacanciesCaption, timezone);
  if (kind === 'followUp') return followUpBasis(digest.followUpCaptions);
  return nextInterviewBasis(digest.nextInterview, timezone);
}

const FOLLOW_UP_STATUS_LABEL: Record<TodayFollowUp['status'], string> = {
  today: 'сегодня',
  overdue: 'просрочен',
  sent: 'отправлен',
};

export function followUpStatusLabel(status: TodayFollowUp['status']): string {
  return FOLLOW_UP_STATUS_LABEL[status];
}

export function consultantTargetView(
  destination: ReasonedCareerAction['destination'],
): CareerCabinetView {
  if (destination === 'career' || destination === 'search') return 'opportunities';
  return 'profile';
}

export function queueItemTarget(item: TodayQueueItem): CareerCabinetView {
  return item.kind === 'new_vacancy' || item.kind === 'shortlist' ? 'opportunities' : 'responses';
}

export function queueKey(item: TodayQueueItem): string {
  return item.applicationId ?? item.clusterId ?? item.title;
}

const RUSSIAN_PATRONYMIC = /^[А-ЯЁ][а-яё]+(?:овна|евна|ична|инична|ович|евич|ич)$/u;
const RUSSIAN_SURNAME = /^[А-ЯЁ][а-яё]+(?:ов|ова|ев|ева|ин|ина|ын|ына|ский|ская|цкий|цкая|их|ых)$/u;
const COMMON_RUSSIAN_GIVEN_NAMES = new Set([
  'Александр',
  'Александра',
  'Алексей',
  'Алена',
  'Алёна',
  'Алиса',
  'Анастасия',
  'Анатолий',
  'Андрей',
  'Анна',
  'Антон',
  'Артём',
  'Артем',
  'Артур',
  'Борис',
  'Вадим',
  'Валентин',
  'Валентина',
  'Валерий',
  'Валерия',
  'Василий',
  'Вера',
  'Вероника',
  'Виктор',
  'Виктория',
  'Виталий',
  'Владимир',
  'Владислав',
  'Всеволод',
  'Вячеслав',
  'Галина',
  'Геннадий',
  'Георгий',
  'Глеб',
  'Григорий',
  'Дарья',
  'Денис',
  'Диана',
  'Дмитрий',
  'Евгений',
  'Евгения',
  'Егор',
  'Екатерина',
  'Елена',
  'Елизавета',
  'Жанна',
  'Иван',
  'Игорь',
  'Илья',
  'Инна',
  'Ирина',
  'Кирилл',
  'Кристина',
  'Ксения',
  'Лариса',
  'Лев',
  'Леонид',
  'Лидия',
  'Любовь',
  'Людмила',
  'Максим',
  'Маргарита',
  'Марина',
  'Мария',
  'Матвей',
  'Михаил',
  'Надежда',
  'Наталья',
  'Наталия',
  'Никита',
  'Николай',
  'Нина',
  'Оксана',
  'Олег',
  'Олеся',
  'Ольга',
  'Павел',
  'Петр',
  'Пётр',
  'Полина',
  'Роман',
  'Руслан',
  'Светлана',
  'Святослав',
  'Сергей',
  'Снежана',
  'София',
  'Софья',
  'Станислав',
  'Степан',
  'Тамара',
  'Татьяна',
  'Тимофей',
  'Тимур',
  'Ульяна',
  'Федор',
  'Фёдор',
  'Филипп',
  'Юлия',
  'Юрий',
  'Ян',
  'Яна',
  'Ярослав',
]);

const COMPANY_MARKERS =
  /\b(inc|llc|ltd|corp|corporation|gmbh|co|group|technologies|solutions|lab|labs|studio|agency|ооо|зао|оао|пао|ип|нко|тех|софт|банк)\b/iu;

export function isPersonName(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || COMPANY_MARKERS.test(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;

  if (words.some((w) => RUSSIAN_PATRONYMIC.test(w))) {
    return true;
  }

  if (words.length === 3 && words.every((w) => /^[А-ЯЁ][а-яё]+$/u.test(w))) {
    return true;
  }

  if (words.length === 2 && words.every((w) => /^[А-ЯЁ][а-яё]+$/u.test(w))) {
    if (words.some((w) => COMMON_RUSSIAN_GIVEN_NAMES.has(w) || RUSSIAN_SURNAME.test(w))) {
      return true;
    }
  }

  return false;
}

/**
 * D10: Сборка заголовка карточки очереди.
 * Правило: «<Компания> — <Должность>»; нет компании → «Компания не указана — <Должность>»;
 * имя человека в заголовок не попадает никогда.
 */
/** Строка очереди по макету: действие — объект, а не «компания — вакансия». */
export function queueActionTitle(item: {
  readonly kind: 'candidate_turn' | 'new_vacancy' | 'shortlist' | 'follow_up' | 'interview';
  readonly company: string | null;
  readonly title: string;
}): string {
  const company = item.company?.trim();
  const named = company && !isPersonName(company) ? company : null;
  if (item.kind === 'follow_up')
    return named ? `Напомнить компании ${named}` : 'Напомнить компании';
  if (item.kind === 'interview') return 'Подготовиться к интервью';
  if (item.kind === 'candidate_turn') return `Ваш ход: ${item.title}`;
  if (item.kind === 'shortlist') return `Из подборки: ${item.title}`;
  return `Новая вакансия: ${item.title}`;
}

/** Компания строки очереди; имя рекрутера в роли компании не показываем. */
export function queueCompanyLabel(company: string | null | undefined): string {
  const clean = company?.trim();
  return clean && !isPersonName(clean) ? clean : 'Компания не указана';
}

export function formatQueueTitle(company: string | null | undefined, title: string): string {
  const cleanCompany = company?.trim();
  if (!cleanCompany || isPersonName(cleanCompany)) {
    return `Компания не указана — ${title}`;
  }
  return `${cleanCompany} — ${title}`;
}

export function companyInitials(company: string | null | undefined): string {
  if (!company || isPersonName(company)) return '—';
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '—';
}

export interface ReturningDigestItem {
  readonly id: 'vacancies' | 'applications' | 'interview';
  readonly label: string;
  readonly targetView: CareerCabinetView;
}

export function formatInterviewDate(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function buildReturningDigestItems(input: {
  since: string | null;
  newVacanciesCount: number;
  applicationsWaitingOver7Days: number;
  nearestInterview: TodayNextInterview | null;
}): readonly ReturningDigestItem[] {
  if (!input.since) return [];

  const items: ReturningDigestItem[] = [];

  if (input.newVacanciesCount > 0) {
    items.push({
      id: 'vacancies',
      label: pluralRu(input.newVacanciesCount, [
        'новая подходящая вакансия',
        'новые подходящие вакансии',
        'новых подходящих вакансий',
      ]),
      targetView: 'opportunities',
    });
  }

  if (input.applicationsWaitingOver7Days > 0) {
    items.push({
      id: 'applications',
      label: pluralRu(input.applicationsWaitingOver7Days, [
        'отклик ждёт ответа больше 7 дней',
        'отклика ждут ответа больше 7 дней',
        'откликов ждут ответа больше 7 дней',
      ]),
      targetView: 'responses',
    });
  }

  if (input.nearestInterview?.at) {
    items.push({
      id: 'interview',
      label: `ближайшее интервью ${formatInterviewDate(input.nearestInterview.at)}`,
      targetView: 'responses',
    });
  }

  return items;
}
