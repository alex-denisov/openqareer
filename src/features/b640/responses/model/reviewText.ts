import type {
  RejectionGuess,
  RejectionRecommendation,
  RejectionReview,
} from '../../../../../shared/rejectionReview';
import type { IconName } from '../../kit';
import { pluralRu } from './responseRow';

const REJECTIONS = ['отказ', 'отказа', 'отказов'] as const;
const RESPONSES = ['отклик', 'отклика', 'откликов'] as const;

const COUNT_WORDS = [
  'Ноль', 'Один', 'Два', 'Три', 'Четыре', 'Пять', 'Шесть', 'Семь', 'Восемь', 'Девять', 'Десять',
] as const;

/** Начало «за месяц»: то же число прошлого месяца; у короткого месяца — его последний день. */
function monthBefore(now: Date): number {
  const start = new Date(now);
  start.setMonth(start.getMonth() - 1);
  if (start.getDate() !== now.getDate()) start.setDate(0);
  return start.getTime();
}

/** «Три отказа за месяц» (o07). Период пишем, когда все показанные отказы в нём. */
export function rejectionsTitle(
  items: readonly Pick<RejectionReview['rejections'][number], 'rejectedAt'>[],
  total: number,
  now: Date = new Date(),
): string {
  if (items.length !== total) return 'Отказы';
  const title = `${COUNT_WORDS[total] ?? total} ${pluralRu(total, REJECTIONS)}`;
  const start = monthBefore(now);
  const recent = items.every((item) => Date.parse(item.rejectedAt) >= start);
  return recent ? `${title} за месяц` : title;
}

/** «из 3 отказов», «из 21 отказа»: родительный падеж после «из». */
function ofRejections(total: number): string {
  return total % 10 === 1 && total % 100 !== 11 ? 'отказа' : 'отказов';
}

/** «Вероятно, не хватило: … — так в вакансии; в профиле …». */
export function guessLine(guess: RejectionGuess): string {
  const profile = guess.profileFact
    ? `в профиле: ${guess.profileFact}`
    : 'подтверждения в профиле не нашли';
  return `Вероятно, не хватило: ${guess.requirement} — так в вакансии; ${profile}`;
}

export interface RecommendationText {
  readonly title: string;
  readonly why: string;
  readonly action: string;
  readonly icon: IconName;
  /** Узел, куда ведёт действие. */
  readonly node: 's01' | 's07' | 'o01';
}

/** Текст рекомендации: стоит только на требовании и факте, которые пришли с сервера. */
export function recommendationText(item: RejectionRecommendation): RecommendationText {
  const share = `${item.count} из ${item.total} ${ofRejections(item.total)}`;
  if (item.kind === 'update_statuses') {
    return {
      title: 'Обновить статусы откликов',
      why: `Без ответа — ${item.count} из ${item.total}.`,
      action: 'Обновить статусы',
      icon: 'refresh',
      node: 'o01',
    };
  }
  if (item.kind === 'show_in_resume') {
    return {
      title: `Показать в резюме: ${item.requirement}`,
      why: `${share}: в вакансии — ${item.requirement}, в профиле: ${item.profileFact}.`,
      action: item.resumeFactId ? 'Поправить резюме' : 'Открыть профиль',
      icon: 'edit',
      node: 's01',
    };
  }
  return {
    title: `Подобрать вакансии без требования «${item.requirement}»`,
    why: `${share}: в вакансии — ${item.requirement}, подтверждения в профиле не нашли.`,
    action: 'Посмотреть вакансии',
    icon: 'vacancies',
    node: 's07',
  };
}

/** Заголовок экрана по состоянию разбора. */
export function reviewTitle(review: RejectionReview): string {
  if (review.state === 'low_data') {
    return `Мало данных для вывода: ${review.sentCount} ${pluralRu(review.sentCount, RESPONSES)}`;
  }
  if (review.firstStep) return recommendationText(review.firstStep).title;
  return `${review.rejectedCount} ${pluralRu(review.rejectedCount, REJECTIONS)} на ${review.sentCount} ${pluralRu(review.sentCount, RESPONSES)}`;
}
