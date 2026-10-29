import { pluralRu } from '../../../shared/pluralRu';
import type {
  ConnectionCircleNumber,
  ConnectionCircleResult,
  VacancyConnectionCircles,
} from './vacancyLetterApi';

/** One card of «Как откликнуться: три круга связей» (B549), built from the
 *  same circles API that the letter screen uses — no numbers of our own. */
export interface PathCircleCard {
  readonly circle: ConnectionCircleNumber;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly actionLabel: string;
  /** false: contacts are unknown or absent, the action acquires them. */
  readonly known: boolean;
  readonly result?: ConnectionCircleResult;
  /** Circle 2 (B561 slice 3): «ask» offers «Попросить рекомендацию» through platform members. */
  readonly referralAction?: 'ask' | null;
}

const TITLES: Record<ConnectionCircleNumber, string> = {
  1: 'Знакомый в компании',
  2: 'Через знакомого',
  3: 'Холодный отклик',
};

const ACTIONS: Record<ConnectionCircleNumber, string> = {
  1: 'Написать знакомому',
  2: 'Показать пути',
  3: 'Подготовить письмо',
};

const UNKNOWN = 'Контакты неизвестны: импортируйте контакты LinkedIn или добавьте знакомых.';

function contactSummary(circle: 1 | 2, count: number, companyName: string): string {
  if (circle === 1) {
    return `${pluralRu(count, ['контакт работает', 'контакта работают', 'контактов работают'])} в ${companyName}.`;
  }
  return `${pluralRu(count, ['путь', 'пути', 'путей'])} через знакомых.`;
}

function platformSummary(count: number): string {
  return `${pluralRu(count, ['путь', 'пути', 'путей'])} через ${count === 1 ? 'участника' : 'участников'} платформы.`;
}

const REFERRAL_ASK = 'Попросить рекомендацию';

/** The referral request state, said after the platform path count. */
function referralNote(result: ConnectionCircleResult | undefined): string {
  const referral = result?.platformReferral;
  if (referral?.status === 'pending') return ' Запрос отправлен, ждём ответа.';
  if (referral?.status === 'accepted') {
    const names = referral.introducers.map((item) => item.fullName).join(', ');
    return ` Готовы рекомендовать: ${names}.`;
  }
  if (referral?.status === 'answered') return ' Участники ответили, но помочь не смогут.';
  return '';
}

function referralAction(result: ConnectionCircleResult | undefined): 'ask' | null {
  return (result?.platformReferral?.status ?? 'none') === 'none' ? 'ask' : null;
}

function warmCard(
  circle: 1 | 2,
  result: ConnectionCircleResult | undefined,
  companyName: string,
): PathCircleCard {
  const base = { circle, label: `Круг ${circle}`, title: TITLES[circle], result };
  const count = result?.state === 'available' ? result.paths.length : 0;
  const platform = circle === 2 ? (result?.platformPaths?.paths ?? 0) : 0;
  if (count > 0) {
    const own = contactSummary(circle, count, companyName);
    return {
      ...base,
      summary:
        platform > 0
          ? `${own.slice(0, -1)} и ${platform} через участников платформы.${referralNote(result)}`
          : own,
      actionLabel: ACTIONS[circle],
      known: true,
      referralAction: platform > 0 ? referralAction(result) : null,
    };
  }
  if (platform > 0) {
    const action = referralAction(result);
    return {
      ...base,
      summary: platformSummary(platform) + referralNote(result),
      actionLabel: action ? REFERRAL_ASK : 'Добавить контакты',
      known: false,
      referralAction: action,
    };
  }
  const summary =
    result?.state === 'none'
      ? circle === 1
        ? `Знакомых в ${companyName} не найдено.`
        : 'Путей через знакомых не найдено.'
      : UNKNOWN;
  return { ...base, summary, actionLabel: 'Добавить контакты', known: false };
}

/** A referral request just sent: circle 2 reads as pending until the next load. */
export function withReferralSent(data: VacancyConnectionCircles): VacancyConnectionCircles {
  return {
    ...data,
    circles: data.circles.map((circle) =>
      circle.circle === 2
        ? { ...circle, platformReferral: { status: 'pending', introducers: [] } }
        : circle,
    ),
  };
}

export function pathCircleCards(data: VacancyConnectionCircles): readonly PathCircleCard[] {
  const find = (circle: ConnectionCircleNumber) => data.circles.find((c) => c.circle === circle);
  const cold = find(3);
  return [
    warmCard(1, find(1), data.companyName),
    warmCard(2, find(2), data.companyName),
    {
      circle: 3,
      label: 'Круг 3',
      title: TITLES[3],
      summary: cold?.message || 'Резюме под вакансию и сопроводительное письмо.',
      actionLabel: ACTIONS[3],
      known: true,
      result: cold,
    },
  ];
}

function formatDate(value: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

export function pathSourceNote(data: VacancyConnectionCircles): string {
  const { state, importedAt, importedCount } = data.linkedinImport;
  if (state !== 'imported') {
    return 'Контакты LinkedIn не импортированы, поэтому круги 1 и 2 неизвестны.';
  }
  const parts = ['Связи — из импорта контактов LinkedIn'];
  if (typeof importedCount === 'number') {
    parts.push(pluralRu(importedCount, ['контакт', 'контакта', 'контактов']));
  }
  const date = formatDate(importedAt);
  if (date) parts.push(date);
  return `${parts.join(', ')}.`;
}
