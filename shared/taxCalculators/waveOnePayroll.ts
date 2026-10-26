/** Tax bases and stated assumptions for the wave 1 countries (sources: shared/taxData/waveOneTaxData). */

export type WaveOneCountryCode = 'AM' | 'KZ' | 'TR' | 'UZ' | 'BY' | 'ME' | 'GB';

const roundToCents = (amount: number): number => Number(amount.toFixed(2));

/** Kazakhstan: 30 MRP (4 325 ₸ in 2026) a month, at most 360 MRP a year. */
const KAZAKHSTAN_BASE_DEDUCTION = 360 * 4_325;
/** Belarus: 216 BYN a month while monthly income is at most 1 308 BYN. */
const BELARUS_STANDARD_DEDUCTION = { monthly: 216, incomeLimit: 1_308 } as const;
/** UK: £12 570 shrinks by £1 for every £2 above £100 000. */
const UK_PERSONAL_ALLOWANCE = { amount: 12_570, taperFrom: 100_000 } as const;

export function isWaveOneCountry(countryCode: string): countryCode is WaveOneCountryCode {
  return ['AM', 'KZ', 'TR', 'UZ', 'BY', 'ME', 'GB'].includes(countryCode);
}

export function ukPersonalAllowance(grossAnnualIncome: number): number {
  const taper = Math.max(0, grossAnnualIncome - UK_PERSONAL_ALLOWANCE.taperFrom) / 2;
  return Math.max(0, UK_PERSONAL_ALLOWANCE.amount - taper);
}

/** The annual taxable base; `contributionsTotal` is what the employee pays to social funds. */
export function waveOneTaxBase(
  countryCode: WaveOneCountryCode,
  grossAnnualIncome: number,
  contributionsTotal: number,
): number {
  switch (countryCode) {
    case 'KZ':
      return roundToCents(
        Math.max(0, grossAnnualIncome - contributionsTotal - KAZAKHSTAN_BASE_DEDUCTION),
      );
    case 'TR':
      // Only the SGK and unemployment premiums are deductible; stamp duty is not.
      return roundToCents(grossAnnualIncome - turkishSocialPremiums(grossAnnualIncome));
    case 'BY':
      return grossAnnualIncome / 12 <= BELARUS_STANDARD_DEDUCTION.incomeLimit
        ? Math.max(0, grossAnnualIncome - BELARUS_STANDARD_DEDUCTION.monthly * 12)
        : grossAnnualIncome;
    case 'GB':
      return roundToCents(Math.max(0, grossAnnualIncome - ukPersonalAllowance(grossAnnualIncome)));
    case 'AM':
    case 'UZ':
    case 'ME':
      return grossAnnualIncome;
  }
}

/** SGK 14 % + unemployment 1 % on pay up to 297 270 TL a month. */
function turkishSocialPremiums(grossAnnualIncome: number): number {
  return roundToCents(Math.min(grossAnnualIncome / 12, 297_270) * 12 * 0.15);
}

const COMMON =
  'Расчёт относится к налоговому году 2026 и использует годовую зарплату, равномерно выплачиваемую 12 месяцев.';

const ASSUMPTIONS: Readonly<Record<WaveOneCountryCode, readonly string[]>> = {
  AM: [
    'Работник с ВНЖ по работе, родившийся в 1974 году или позже: с него удерживаются накопительная пенсия и взнос в фонд страхования военнослужащих. Иностранец без статуса проживания эти платежи не вносит.',
    'Пониженная ставка 10% для отдельных высокотехнологичных работ не учитывается.',
  ],
  KZ: [
    'Налоговый резидент Казахстана: из базы вычтены пенсионные и медицинские взносы и базовый вычет 30 МРП в месяц.',
    'Медицинские взносы удерживаются с граждан и постоянно проживающих; у иностранца без вида на жительство их может не быть.',
  ],
  TR: [
    'Наёмный работник: из базы вычтены взносы SGK и на страхование от безработицы, часть зарплаты в размере минимальной не облагается налогом и гербовым сбором.',
    'Годовой расчёт заменяет помесячный; при неравных выплатах налог за месяц может отличаться.',
  ],
  UZ: [
    'Налоговый резидент Узбекистана; пенсионный взнос 0,1% входит в 12% налога и отдельно не удерживается.',
  ],
  BY: [
    'Применяется стандартный вычет при доходе до 1 308 BYN в месяц; вычеты на детей не учитываются.',
    'Предел базы пенсионного взноса — пять средних зарплат за предыдущий месяц: по данным Белстата за август 2026 года это 15 679,5 BYN в месяц; он меняется каждый месяц.',
  ],
  ME: [
    'Налог считается с месячной зарплаты до вычета взносов по шкале 0% до 700 €, 9% до 1 000 €, 15% выше.',
    'Включена надбавка к налогу Подгорицы 15%; в других общинах ставка своя.',
    'Предел базы пенсионного взноса взят за 2025 год: значение на 2026 год ещё не опубликовано.',
  ],
  GB: [
    'Англия, Уэльс и Северная Ирландия, налоговый год 2026–27; необлагаемый минимум уменьшается на £1 за каждые £2 дохода сверх £100 000.',
    'National Insurance по категории A; пенсионные отчисления работодателя и студенческий кредит не учитываются.',
  ],
};

const SUMMARIES: Readonly<Record<WaveOneCountryCode, string>> = {
  AM: 'ВНЖ по работе, накопительная пенсия и военный взнос',
  KZ: 'Налоговый резидент, взносы и 30 МРП вычтены из базы',
  TR: 'Наёмный работник, минимальная зарплата не облагается',
  UZ: 'Налоговый резидент, 12% без отдельных взносов',
  BY: 'Без вычетов на детей, предел взноса по зарплате за август 2026',
  ME: 'Подгорица, надбавка 15%, предел взноса за 2025 год',
  GB: 'Англия, налоговый год 2026–27, National Insurance категории A',
};

export function waveOneAssumptions(countryCode: WaveOneCountryCode): string[] {
  return [COMMON, ...ASSUMPTIONS[countryCode]];
}

export function waveOneAssumptionSummary(countryCode: WaveOneCountryCode): string {
  return SUMMARIES[countryCode];
}
