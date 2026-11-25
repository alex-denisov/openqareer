/** B787: границы числового поля формы работодателя, как их называет сама форма. */
export interface NumberLimits {
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  /** Единица поля, например «$». */
  readonly unit: string | null;
}

interface NumericQuestion {
  readonly numeric?: boolean;
  readonly limits?: NumberLimits;
}

const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/u;
const STEP_TOLERANCE = 1e-6;

const onStep = (value: number, limits: NumberLimits): boolean => {
  if (!limits.step) return true;
  const steps = (value - (limits.min ?? 0)) / limits.step;
  return Math.abs(steps - Math.round(steps)) < STEP_TOLERANCE;
};

const within = (value: number, { min, max }: NumberLimits): boolean =>
  (min === null || value >= min) && (max === null || value <= max);

/** Число ответа, которое поле примет без изменений; иначе `null`. */
export function acceptedNumber(text: string, limits?: NumberLimits | null): number | null {
  const compact = text.replace(/\s/gu, '');
  if (!PLAIN_NUMBER.test(compact)) return null;
  const value = Number(compact.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return !limits || (within(value, limits) && onStep(value, limits)) ? value : null;
}

/** Ближайшее число на шаге поля; вне границ — `null`. */
export function nearestAccepted(value: number, limits?: NumberLimits): number | null {
  if (!limits) return value;
  if (!within(value, limits)) return null;
  const base = limits.min ?? 0;
  const stepped = limits.step
    ? base + Math.round((value - base) / limits.step) * limits.step
    : value;
  const rounded = Number(stepped.toFixed(6));
  return within(rounded, limits) ? rounded : null;
}

/** Ответ есть, но числовое поле его не примет. */
export function isBadNumber(question: NumericQuestion, text: string): boolean {
  return Boolean(question.numeric && text.trim()) && acceptedNumber(text, question.limits) === null;
}

const show = (value: number): string => new Intl.NumberFormat('ru-RU').format(value);

/** «Число от 0 до 50 000 $, шаг 500». */
export function numberRule({ limits }: NumericQuestion): string {
  const { min = null, max = null, step = null, unit = null } = limits ?? {};
  const from = min === null ? '' : ` от ${show(min)}`;
  const to = max === null ? '' : ` до ${show(max)}`;
  const every = step !== null && step !== 1 ? `, шаг ${show(step)}` : '';
  return `Число${from}${to}${unit ? ` ${unit}` : ''}${every}`;
}
