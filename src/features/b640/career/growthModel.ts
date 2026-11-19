import type { GrowthGoalKind, GrowthStep } from './growthApi';

export const GOAL_OPTIONS: ReadonlyArray<readonly [GrowthGoalKind, string]> = [
  ['promotion', 'Повышение в должности'],
  ['raise', 'Прибавка в той же роли'],
  ['other_role', 'Другая роль внутри компании'],
  ['stay', 'Пока остаюсь как есть'],
];

export interface GoalCopy {
  readonly title: string;
  /** Кнопка подготовки разговора; у «остаюсь» разговора нет. */
  readonly action: string | null;
  readonly side: string;
}

const TALK: Record<Exclude<GrowthGoalKind, 'stay'>, readonly [string, string]> = {
  promotion: ['Повышение', 'о повышении'],
  raise: ['Прибавка', 'о прибавке'],
  other_role: ['Другая роль', 'о переходе'],
};

/** Заголовок, действие и подпись доводов по цели. */
export function goalCopy(kind: GrowthGoalKind, company: string): GoalCopy {
  const where = `в компании «${company}»`;
  if (kind === 'stay')
    return { title: `Остаюсь ${where}`, action: null, side: 'Ваши результаты за год' };
  const [head, about] = TALK[kind];
  return {
    title: `${head} ${where}`,
    action: `Подготовить разговор ${about}`,
    side: `Аргументы к разговору ${about}`,
  };
}

export function goalChosenTip(chosenAt: string): string {
  const day = new Date(chosenAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `Цель выбрана ${day}.`;
}

function vacanciesWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вакансия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вакансии';
  return 'вакансий';
}

export function wageTip(sampleSize: number, observedAt: string): string {
  const date = new Date(observedAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
  return `hh.ru, ${sampleSize} ${vacanciesWord(sampleSize)} с указанной зарплатой, на ${date}.`;
}

export function stepTag(state: GrowthStep['state']) {
  if (state === 'done') return { cls: 'step done', tag: 'ok', text: 'есть' } as const;
  if (state === 'now') return { cls: 'step now', tag: 'part', text: 'в работе' } as const;
  return { cls: 'step', tag: 'miss', text: 'дальше' } as const;
}
