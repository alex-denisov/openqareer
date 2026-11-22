import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { formatValue, indicatorsOf } from './goalsModel';

/** Позиция «Опыта» в профиле, под которую встаёт строка результата. */
export interface TransferPlace {
  readonly id: string;
  readonly label: string;
  readonly current: boolean;
}

interface ProfileExperience {
  readonly id: string;
  readonly title?: string;
  readonly employer?: string;
  readonly current?: boolean;
  readonly endDate?: string;
}

/** «Руководитель разработки, Вектор Банк»; без названия — работодатель или «Место работы». */
export function placeLabel(experience: ProfileExperience): string {
  const parts = [experience.title?.trim(), experience.employer?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Место работы';
}

export function placesOf(experiences: readonly ProfileExperience[]): TransferPlace[] {
  return experiences.map((experience) => ({
    id: experience.id,
    label: placeLabel(experience),
    current: Boolean(experience.current) && !experience.endDate,
  }));
}

/**
 * Место по умолчанию — как у дневника: связанное с местом работы, иначе единственное
 * текущее. Иначе — null: кандидат выбирает сам, новое место не создаём.
 */
export function defaultPlace(
  places: readonly TransferPlace[],
  linkedId: string | null | undefined,
): string | null {
  const linked = places.find((place) => place.id === linkedId);
  if (linked) return linked.id;
  const current = places.filter((place) => place.current);
  return current.length === 1 ? current[0]!.id : null;
}

/**
 * Строка для профиля из достигнутой цели: «Выпускать релиз за неделю: с 14 до 7 дней» по первому
 * показателю с исходным значением и замером; иначе — название цели. Кандидат её правит.
 */
export function transferLine(card: CareerDiaryGoalCard): string {
  const measured = indicatorsOf(card).find(
    (goal) => goal.latestMeasurement && typeof goal.baselineValue === 'number',
  );
  if (!measured?.latestMeasurement || typeof measured.baselineValue !== 'number') {
    return card.title;
  }
  const { unit } = measured;
  const from = formatValue(measured.baselineValue, unit);
  const to = formatValue(measured.latestMeasurement.value, unit);
  const tail = unit && unit !== '%' ? ` ${unit}` : '';
  return `${card.title}: с ${from} до ${to}${tail}`;
}
