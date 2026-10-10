export const MIN_WAGE_SAMPLE = 8;
const MS_PER_DAY = 86_400_000;
const STALE_THRESHOLD_DAYS = 14;

export interface RoleWageInput {
  readonly sampleSize: number;
  readonly minSalary?: number;
  readonly maxSalary?: number;
}

export interface RoleWageForkResult {
  readonly isCalculated: boolean;
  readonly display: string;
  readonly minFormatted?: string;
  readonly maxFormatted?: string;
  readonly sampleSize: number;
}

function formatThousands(rubles: number): string {
  const thousands = Math.round(rubles / 1000);
  return thousands.toLocaleString('ru-RU');
}

export function calculateRoleWageFork(input: RoleWageInput): RoleWageForkResult {
  const { sampleSize, minSalary, maxSalary } = input;

  if (sampleSize < MIN_WAGE_SAMPLE || (!minSalary && !maxSalary)) {
    return {
      isCalculated: false,
      display: 'вилка не считается',
      sampleSize,
    };
  }

  if (minSalary && maxSalary) {
    const minFormatted = formatThousands(minSalary);
    const maxFormatted = formatThousands(maxSalary);
    return {
      isCalculated: true,
      display: `${minFormatted}–${maxFormatted} тыс. ₽`,
      minFormatted,
      maxFormatted,
      sampleSize,
    };
  }

  if (minSalary) {
    const minFormatted = formatThousands(minSalary);
    return {
      isCalculated: true,
      display: `от ${minFormatted} тыс. ₽`,
      minFormatted,
      sampleSize,
    };
  }

  const maxFormatted = formatThousands(maxSalary!);
  return {
    isCalculated: true,
    display: `до ${maxFormatted} тыс. ₽`,
    maxFormatted,
    sampleSize,
  };
}

export function formatVacancyCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} вакансий`;
  }
  if (mod10 === 1) {
    return `${count} вакансия`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} вакансии`;
  }
  return `${count} вакансий`;
}

export function isMarketSampleStale(
  observedAtIso: string,
  referenceDate: Date = new Date(),
): boolean {
  const observedMs = new Date(observedAtIso).getTime();
  if (Number.isNaN(observedMs)) return false;
  const elapsedDays = (referenceDate.getTime() - observedMs) / MS_PER_DAY;
  return elapsedDays > STALE_THRESHOLD_DAYS;
}
