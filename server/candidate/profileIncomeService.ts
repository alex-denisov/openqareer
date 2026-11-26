import { randomUUID } from 'node:crypto';
import type { SqliteProfileChangeLogRepository } from '../data/sqliteProfileChangeLogRepository';
import type {
  CandidateIncome,
  SqliteCandidateIncomeRepository,
} from './sqliteCandidateIncomeRepository';

/**
 * B673: нынешний доход и ожидания. Видит и меняет только сам кандидат; правка
 * попадает в «Историю изменений» (её тексты запечатаны и тоже видны только ему).
 */
export const INCOME_HISTORY_SECTION = 'income';
export const INCOME_MAX_RUBLES = 100_000_000;

const LABELS = { current: 'Доход сейчас', expected: 'Ожидания по доходу' } as const;
const RUBLES = new Intl.NumberFormat('ru-RU');

export interface ProfileIncomeDeps {
  readonly income: SqliteCandidateIncomeRepository;
  readonly changeLog: Pick<SqliteProfileChangeLogRepository, 'record'>;
}

function incomeText(value: number | null): string {
  return value === null ? '' : `${RUBLES.format(value)} ₽`;
}

export function readProfileIncome(deps: ProfileIncomeDeps, candidateId: string): CandidateIncome {
  return deps.income.get(candidateId);
}

/** Сохраняет доход и ожидания; каждое изменившееся поле — своя запись в истории. */
export function saveProfileIncome(
  deps: ProfileIncomeDeps,
  candidateId: string,
  next: CandidateIncome,
  now: Date,
): CandidateIncome {
  const previous = deps.income.get(candidateId);
  const stored = deps.income.put(candidateId, next, now.toISOString());
  for (const field of ['current', 'expected'] as const) {
    if (previous[field] === stored[field]) continue;
    deps.changeLog.record({
      id: randomUUID(),
      candidateId,
      actor: 'candidate',
      section: INCOME_HISTORY_SECTION,
      itemId: field,
      label: LABELS[field],
      previous: incomeText(previous[field]),
      applied: incomeText(stored[field]),
      commandId: null,
      createdAt: now.toISOString(),
    });
  }
  return stored;
}
