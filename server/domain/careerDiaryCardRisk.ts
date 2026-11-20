import type { CareerDiaryGoalRisk, CareerDiaryGoalRiskStatus } from '../../shared/careerDiary';

/** Порядок важности: первым показываем то, что требует внимания. */
const WEIGHT: Record<CareerDiaryGoalRiskStatus, number> = {
  at_risk: 4,
  on_track: 3,
  planned: 2,
  achieved: 1,
  unknown: 0,
};

/**
 * Риск карточки цели. Замеры вносятся в показатели, а не в саму цель, поэтому собственный
 * риск цели с показателями всегда «нет замера» (прод 20.11). Такая цель берёт риск у
 * показателей: отстаёт любой — отстаёт цель; достигнуты все — достигнута; иначе — самый
 * важный из замеренных. Пояснение «Как считается» — у того же показателя.
 */
export function cardRisk(
  own: CareerDiaryGoalRisk,
  indicators: readonly CareerDiaryGoalRisk[],
): CareerDiaryGoalRisk {
  if (indicators.length === 0) return own;
  if (indicators.every((risk) => risk.status === 'achieved')) return indicators[0]!;
  const measured = indicators.filter((risk) => risk.status !== 'achieved');
  return measured.reduce((worst, risk) =>
    WEIGHT[risk.status] > WEIGHT[worst.status] ? risk : worst,
  );
}
