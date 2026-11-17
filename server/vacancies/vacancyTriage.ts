import type {
  VacancyTriage,
  VacancyTriageAnswers,
  VacancyTriageQuestion,
  VacancyTriageRow,
} from '../../shared/b640Vacancies';
import { convertAmount, currencyCode, sameCurrency, type CurrencyRates } from '../../shared/currencyRates';
import { monthlyRubSalary } from '../../shared/monthlyRubSalary';
import type { VacancyFitGates } from '../../shared/vacancyFit';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/** B675: разбор списка по правилам. Чистая функция: без базы, без модели. */
export interface TriageInput {
  readonly rows: readonly MatchedVacancyItem[];
  /** «Зарплата от» кандидата в его валюте; без неё зарплатного правила нет. */
  readonly salaryFloor?: { readonly amount: number; readonly currency: string };
  readonly rates?: CurrencyRates;
  readonly answers: VacancyTriageAnswers;
  readonly appliedIds: ReadonlySet<string>;
}

const SALARY_QUESTION: VacancyTriageQuestion = {
  id: 'salaryLowerBound',
  text: 'Сравнивать по нижней границе зарплаты?',
};

const hide = (clusterId: string, reasonId: string, reasonLabel: string): VacancyTriageRow => ({
  clusterId,
  verdict: 'hide',
  reasonId,
  reasonLabel,
});
const keep = (clusterId: string): VacancyTriageRow => ({ clusterId, verdict: 'keep' });
const BELOW = (id: string) => hide(id, 'comp-below', 'зарплата ниже');

function gatesOf(item: MatchedVacancyItem): VacancyFitGates | undefined {
  return item.explanation.fitView?.result?.gates;
}

function gateRule(item: MatchedVacancyItem): VacancyTriageRow | undefined {
  const gates = gatesOf(item);
  if (!gates) return undefined;
  const id = item.cluster.id;
  if (gates.role.status === 'blocked') return hide(id, 'role-family', 'не та роль');
  if (gates.level.status === 'blocked') return hide(id, 'level', 'не тот уровень');
  const regionBlocked = gates.region.status === 'blocked' && !item.cluster.isRemote;
  if (regionBlocked || gates.workFormat.status === 'blocked') {
    return hide(id, 'geo-format', 'не те условия');
  }
  return undefined;
}

/** Одна валюта у вилки и порога сравнивается напрямую: курс 1:1 в общей единице, если реального нет. */
function ratesFor(salaryCurrency: string, floorCurrency: string, rates: CurrencyRates | undefined): CurrencyRates | undefined {
  if (!sameCurrency(salaryCurrency, floorCurrency)) return rates;
  const code = currencyCode(salaryCurrency);
  if (rates?.rubPerUnit[code]) return rates;
  return { date: rates?.date ?? '', rubPerUnit: { ...rates?.rubPerUnit, [code]: 1 } };
}

type SalaryCheck = 'below' | 'crosses' | 'fine';

function salaryCheck(item: MatchedVacancyItem, input: TriageInput): SalaryCheck {
  const { salaryFloor } = input;
  const salary = item.cluster.salary;
  if (!salaryFloor || !salary) return 'fine';
  const rates = ratesFor(salary.currency ?? 'RUR', salaryFloor.currency, input.rates);
  const floor = convertAmount(salaryFloor.amount, salaryFloor.currency, 'RUB', rates);
  const monthly = monthlyRubSalary(salary, rates);
  if (floor === undefined || !monthly) return 'fine';
  const values = [monthly.from, monthly.to].filter((value): value is number => value !== undefined);
  const high = Math.max(...values);
  const low = Math.min(...values);
  if (high < floor) return 'below';
  return low < floor ? 'crosses' : 'fine';
}

function judge(item: MatchedVacancyItem, input: TriageInput, check: SalaryCheck): VacancyTriageRow {
  const id = item.cluster.id;
  if (input.appliedIds.has(id) || item.explanation.candidateDecision?.status === 'saved') return keep(id);
  const byGate = gateRule(item);
  if (byGate) return byGate;
  if (check === 'below') return BELOW(id);
  if (check !== 'crosses') return keep(id);
  const answer = input.answers.salaryLowerBound;
  if (answer === undefined) return { clusterId: id, verdict: 'needs_data', questionId: SALARY_QUESTION.id };
  return answer ? BELOW(id) : keep(id);
}

/** Вопрос нужен списку, если до него дошла хотя бы одна строка, независимо от ответа. */
function reachesQuestion(item: MatchedVacancyItem, input: TriageInput, check: SalaryCheck): boolean {
  const id = item.cluster.id;
  if (check !== 'crosses') return false;
  return !input.appliedIds.has(id) && item.explanation.candidateDecision?.status !== 'saved' && !gateRule(item);
}

export function triageVacancies(input: TriageInput): VacancyTriage {
  const checks = input.rows.map((item) => salaryCheck(item, input));
  const rows = input.rows.map((item, index) => judge(item, input, checks[index]));
  const asked = input.rows.some((item, index) => reachesQuestion(item, input, checks[index]));
  const unanswered = asked && input.answers.salaryLowerBound === undefined;
  const count = (verdict: VacancyTriageRow['verdict']) => rows.filter((row) => row.verdict === verdict).length;
  return {
    rows,
    questions: unanswered ? [SALARY_QUESTION] : [],
    questionTotal: asked ? 1 : 0,
    summary: { total: rows.length, keep: count('keep'), hide: count('hide'), needsData: count('needs_data') },
  };
}
