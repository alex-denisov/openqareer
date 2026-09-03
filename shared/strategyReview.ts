/**
 * Когда пересматривать стратегию после запуска кампании (B180, срез 4).
 *
 * Основано на порогах карьерного стратега. Все пороги — стартовые гипотезы,
 * подлежащие калибровке на собственных наблюдениях; они намеренно
 * консервативны, потому что ранний вывод на малой выборке хуже отсутствия
 * вывода.
 *
 * Главное, что этот модуль обязан делать честно: **не считать то, чего продукт
 * не измеряет.** Из шести воронковых порогов записки продукт сегодня умеет
 * два — остальным нужны просмотры, ответы и интервью, которых не отслеживает
 * ничто. Ноль на их месте означал бы «посмотрели и не нашли», поэтому они
 * названы неотслеживаемыми вслух (то же правило, что запрещает кольцо «68 из
 * 100» без знаменателя, B179).
 */

const DAY_MS = 86_400_000;

/** Порядок изменений: от дешёвого и быстро измеримого к дорогому и медленному. */
export const CHANGE_ORDER = [
  'маршрут',
  'материалы и скрининговые ответы',
  'грейд',
  'география',
  'отрасль',
  'роль',
] as const;

/** Семь дней без единого отклика при непустой очереди — это авария. */
const TRANSPORT_STALL_DAYS = 7;
/** Выборка старше тридцати дней требует пересчёта спроса до любого вывода. */
const DEMAND_SAMPLE_DAYS = 30;
/** Смена роли обнуляет воронку, поэтому у неё отдельный, более высокий барьер. */
const ROLE_CHANGE_DAYS = 14;
const ROLE_CHANGE_DELIVERED = 20;

/** Отклик засчитывается только доставленный: расписка, а не намерение. */
const DELIVERED_STATUS = 'completed_with_receipt';

export type StrategySignalState =
  /** Порог перейдён — есть что менять. */
  | 'fired'
  /** Считали и порог не перейдён. */
  | 'quiet'
  /** Данных ниже минимума: вывод на такой выборке хуже отсутствия вывода. */
  | 'not-enough-data'
  /** Величину не измеряет ничто — и это сказано словами, а не нулём. */
  | 'untracked';

export interface StrategySignalMeasure {
  readonly value: number;
  readonly total: number;
  readonly basis: string;
}

export interface StrategySignal {
  readonly id: string;
  readonly title: string;
  readonly state: StrategySignalState;
  readonly measure?: StrategySignalMeasure;
  /** Что менять, в порядке дешевизны. Пусто, когда менять нечего. */
  readonly whatToChange: readonly string[];
  readonly note: string;
}

export interface StrategyReview {
  readonly signals: readonly StrategySignal[];
  /**
   * Менять по одной переменной за раз: две сразу делают результат
   * неинтерпретируемым, и следующая гипотеза строится на шуме.
   */
  readonly oneVariableAtATime: true;
}

export interface StrategyReviewInput {
  /** Когда выбрана нынешняя версия роли. `null` — роль ещё не выбрана. */
  readonly strategyDecidedAt: string | null;
  readonly commands: readonly { readonly status: string; readonly deliveredAt: string | null }[];
  readonly pool: {
    readonly size: number;
    readonly oldestObservedAt: string | null;
    readonly newestObservedAt: string | null;
  };
  readonly now: string;
}

export function reviewStrategy(input: StrategyReviewInput): StrategyReview {
  return {
    signals: [transportStall(input), demandSampleAge(input), ...untrackedSignals()],
    oneVariableAtATime: true,
  };
}

/**
 * Семь дней без единого доставленного отклика при непустой очереди.
 *
 * Это не стратегия и не гипотеза роли — это поломка транспорта или
 * eligibility. Чинить, не трогая роль.
 */
function transportStall(input: StrategyReviewInput): StrategySignal {
  const delivered = input.commands
    .filter((command) => command.status === DELIVERED_STATUS && command.deliveredAt)
    .map((command) => Date.parse(command.deliveredAt as string))
    .filter((time) => Number.isFinite(time));
  const queued = input.commands.length > 0 || input.pool.size > 0;
  const title = 'Отклики не доходят';

  if (!queued) {
    return {
      id: 'transport-stall',
      title,
      state: 'not-enough-data',
      whatToChange: [],
      note: 'Очередь пуста — отправлять было нечего, поэтому вывод делать не из чего.',
    };
  }

  const days = delivered.length
    ? Math.floor((Date.parse(input.now) - Math.max(...delivered)) / DAY_MS)
    : daysSince(input.strategyDecidedAt, input.now) ?? TRANSPORT_STALL_DAYS;

  if (days < TRANSPORT_STALL_DAYS) {
    return {
      id: 'transport-stall',
      title,
      state: 'quiet',
      measure: measure(days, TRANSPORT_STALL_DAYS, 'дней с последнего доставленного отклика'),
      whatToChange: [],
      note: 'Отклики доходят.',
    };
  }

  return {
    id: 'transport-stall',
    title,
    state: 'fired',
    measure: measure(days, TRANSPORT_STALL_DAYS, 'дней без доставленного отклика при непустой очереди'),
    whatToChange: ['транспорт'],
    note: 'Это не стратегия, это авария: проверять транспорт и право на отклик, гипотезу роли не трогать.',
  };
}

/** Выборка старше тридцати дней: спрос пересчитывается до любого нового вывода. */
function demandSampleAge(input: StrategyReviewInput): StrategySignal {
  const newest = input.pool.newestObservedAt;
  const days = daysSince(newest, input.now);
  const title = 'Возраст выборки вакансий';

  if (input.pool.size === 0 || days === null) {
    return {
      id: 'demand-sample-age',
      title,
      state: 'not-enough-data',
      whatToChange: [],
      note: 'Выборки нет — возраст считать не по чему.',
    };
  }

  return days >= DEMAND_SAMPLE_DAYS
    ? {
        id: 'demand-sample-age',
        title,
        state: 'fired',
        measure: measure(days, DEMAND_SAMPLE_DAYS, 'дней самому свежему наблюдению пула'),
        whatToChange: ['пересчёт спроса'],
        note: 'Спрос пересчитывается до любого нового вывода: старая выборка отвечает про прошлый месяц.',
      }
    : {
        id: 'demand-sample-age',
        title,
        state: 'quiet',
        measure: measure(days, DEMAND_SAMPLE_DAYS, 'дней самому свежему наблюдению пула'),
        whatToChange: [],
        note: 'Выборка свежая.',
      };
}

/**
 * Пороги, для которых у продукта нет входа.
 *
 * Они названы здесь, а не выброшены, ровно по одной причине: сигнал, о котором
 * не сказано, читается кандидатом как «всё в порядке». Ноль на их месте был бы
 * враньём — мы не смотрели, а не посмотрели и не нашли.
 */
function untrackedSignals(): StrategySignal[] {
  return [
    {
      id: 'qualified-share',
      title: 'Много просмотрено, мало подходящих',
      state: 'untracked',
      whatToChange: ['география', 'грейд'],
      note: 'Просмотренные кластеры не отслеживается ничем, поэтому сигнал не считается.',
    },
    {
      id: 'no-human-answer',
      title: 'Отклики доходят, ответов нет',
      state: 'untracked',
      whatToChange: ['маршрут', 'материалы и скрининговые ответы', 'грейд'],
      note: 'Человеческие ответы не отслеживается ничем, поэтому сигнал не считается.',
    },
    {
      id: 'first-conversation',
      title: 'Ответы есть, разговоров нет',
      state: 'untracked',
      whatToChange: ['скрининговые ответы', 'доказательства опыта'],
      note: 'Разговоры и интервью не отслеживается ничем, поэтому сигнал не считается.',
    },
  ];
}

export interface RoleChangeBarrier {
  readonly met: boolean;
  readonly days: StrategySignalMeasure;
  readonly delivered: StrategySignalMeasure;
  /** Что кандидат теряет сменой роли — он обязан это увидеть. */
  readonly loses: string;
}

/**
 * Барьер смены роли.
 *
 * Смена роли обнуляет воронку и уничтожает сравнимость накопленных данных,
 * поэтому у неё отдельный, более высокий барьер: не раньше четырнадцати дней
 * кампании и не меньше двадцати доставленных откликов. Барьер **показывается,
 * а не запрещает**: решение о своей роли принимает кандидат, а продукт обязан
 * назвать цену — это разные вещи.
 */
export function roleChangeBarrier(input: {
  readonly strategyDecidedAt: string | null;
  readonly delivered: number;
  readonly now: string;
}): RoleChangeBarrier {
  const days = daysSince(input.strategyDecidedAt, input.now) ?? 0;
  const loses =
    'Смена роли обнулит накопленную воронку: отклики, ответы и разговоры по прежней роли перестанут быть сравнимыми. Прежняя гипотеза останется в истории решений.';
  // Роли ещё нет — терять нечего, и барьер не имеет смысла.
  if (!input.strategyDecidedAt) {
    return {
      met: true,
      days: measure(0, ROLE_CHANGE_DAYS, 'дней кампании по нынешней роли'),
      delivered: measure(input.delivered, ROLE_CHANGE_DELIVERED, 'доставленных откликов'),
      loses,
    };
  }
  return {
    met: days >= ROLE_CHANGE_DAYS && input.delivered >= ROLE_CHANGE_DELIVERED,
    days: measure(days, ROLE_CHANGE_DAYS, 'дней кампании по нынешней роли'),
    delivered: measure(input.delivered, ROLE_CHANGE_DELIVERED, 'доставленных откликов'),
    loses,
  };
}

function measure(value: number, total: number, basis: string): StrategySignalMeasure {
  return { value, total, basis };
}

function daysSince(at: string | null, now: string): number | null {
  if (!at) return null;
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.parse(now) - time) / DAY_MS);
}
