import type { RelocationScenarioResult as Result, SavedRelocationScenario } from '../../../shared/relocationScenario';
import { EXPENSE_LABELS, UPFRONT_LABELS } from './RelocationScenarioCosts';
const money = (n: number | null, c: string) => n === null ? 'Нет полного расчёта' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)} ${c}`;
const status = { available: 'Условия выполнены по введённым данным', barriers: 'Есть препятствия', unknown: 'Нужны дополнительные сведения', unavailable: 'Маршрут недоступен по проверенным условиям' };
export function RelocationScenarioResultView({ result }: { readonly result: Result }) {
  return <div className="career-relocation-scenario-result" aria-live="polite">
    <h3>Итог сценария</h3>
    <dl>
      <dt>Доход после налогов, в месяц</dt><dd>{money(result.monthlyNetIncome, result.currency)} · {result.incomeStatus === 'salary_estimate' ? 'зарплатная модель' : 'данные кандидата'}</dd>
      <dt>Известные регулярные расходы</dt><dd>{money(result.monthlyKnownCosts, result.currency)}</dd>
      <dt>Остаток в месяц</dt><dd>{money(result.monthlyRemaining, result.currency)}</dd>
      <dt>Разовые расходы</dt><dd>{money(result.upfrontSpending, result.currency)}</dd>
      <dt>Возвратный депозит</dt><dd>{money(result.refundableDeposit, result.currency)}</dd>
      <dt>Деньги на старт с резервом</dt><dd>{money(result.requiredCash, result.currency)}</dd>
      {result.comparisonCurrency && <><dt>Остаток в валюте сравнения</dt><dd>{money(result.comparisonMonthlyRemaining, result.comparisonCurrency)}</dd></>}
    </dl>
    {result.missingCosts.length > 0 && <p>Не заполнены расходы: {result.missingCosts.map((key) => EXPENSE_LABELS[key]).join(', ')}. Остаток не определён.</p>}
    {result.missingUpfront.length > 0 && <p>Не заполнены первоначальные суммы: {result.missingUpfront.map((key) => UPFRONT_LABELS[key]).join(', ')}.</p>}
    {result.missingProofOfFunds && <p>Укажите средства для подтверждения визы; если они не требуются, укажите 0 с основанием.</p>}
    {result.payroll && <details><summary>Налоги и взносы · {result.taxYear}</summary><p>Налог на доход: {money(result.payroll.incomeTax.amount, result.currency)} в год.</p>{result.payroll.employeeContributions.items.map((item) => <p key={item.name}>{item.name}: {money(item.amount, result.currency)} в год. <a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title}</a> · {item.source.retrievedAt}</p>)}</details>}
    {result.documentWarnings.map((warning, i) => <p role="note" key={`${warning.kind}-${i}`}>{warning.kind === 'citizenship_missing' ? 'В анкете не указано гражданство.' : `Документ ${warning.kind === 'document_expired' ? 'истёк' : 'истекает'} ${warning.expiresAt}. Проверьте применимость визового маршрута.`}</p>)}
    <details open><summary>Визовый маршрут и ограничения</summary>
      {result.mobility ? <><p>{result.mobility.label}: {status[result.mobility.status]}</p><ul>{result.mobility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{result.mobility.paths.map((path) => <div key={path.id}><h4>{path.label}</h4><p>{status[path.status]}</p><ul>{path.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>)}{result.mobility.thresholds.map((t) => <p key={`${t.requirement}-${t.label}`}>{t.label}: {t.amount} {t.currency} · {t.period}. <a href={t.source.url} target="_blank" rel="noreferrer">Источник</a> · {t.source.retrievedAt}</p>)}{result.mobility.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.retrievedAt} · {source.dataYear}</p>)}</> : <p>Для этого сценария маршрут не описан.</p>}
    </details>
    <details><summary>Источники налогов и допущения</summary>{result.taxSources.map((source, i) => <p key={`${source.url}-${i}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.retrievedAt} · {source.dataYear}</p>)}<ul>{result.assumptions.map((text) => <li key={text}>{text}</li>)}</ul></details>
  </div>;
}
export function SavedScenarioComparison({ items }: { readonly items: readonly SavedRelocationScenario[] }) {
  return <section aria-label="Сравнение бюджетов"><h3>Сравнение сохранённых сценариев</h3><p>Суммы разных валют не ранжируются. Для общего сравнения задайте курс и его источник в каждом сценарии.</p><div className="career-relocation-scenario-comparison">{items.map((s) => <article key={s.id}><h4>{s.input.name}</h4><p>{s.input.city} · {s.input.householdSize} чел. · {s.createdAt.slice(0, 10)}</p><p>Остаток: {money(s.result.monthlyRemaining, s.result.currency)}</p><p>Деньги на старт: {money(s.result.requiredCash, s.result.currency)}</p>{s.result.comparisonCurrency && <p>В валюте сравнения: {money(s.result.comparisonMonthlyRemaining, s.result.comparisonCurrency)} · курс от {s.input.comparisonRate?.observedAt}</p>}<p>Виза: {s.result.mobility ? status[s.result.mobility.status] : 'неизвестно'}</p></article>)}</div></section>;
}
