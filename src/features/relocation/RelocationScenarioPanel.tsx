import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { calculateRelocationScenario, RELOCATION_EXPENSES, RELOCATION_UPFRONT, relocationScenarioInputSchema, type RelocationCost, type RelocationScenarioInput, type RelocationScenarioResult, type SavedRelocationScenario } from '../../../shared/relocationScenario';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { relocationVisaProfile } from '../../../shared/relocationVisaProfile';
import { relocationHousingReferences } from '../../../shared/relocationReferences';
import { getCountryTaxData } from '../../../shared/taxData';
import { EXPENSE_LABELS, ScenarioCostField, UPFRONT_LABELS } from './RelocationScenarioCosts';
import { RelocationScenarioResultView, SavedScenarioComparison } from './RelocationScenarioResult';
import { deleteRelocationScenario, listRelocationScenarios, saveRelocationScenario } from './relocationScenarioApi';
import './relocation-scenarios.css';
import { RelocationVisaExtras, VisaCitizenships } from './RelocationVisaExtras';

const VISA_FLAGS = { hasJobOffer: 'Есть предложение о работе', approvedEmployerSponsor: 'Работодатель подтвердил спонсорство', occupationEligible: 'Профессия подходит выбранному маршруту', occupationGoingRateMet: 'Отраслевой порог зарплаты выполнен', completedFormalQualification: 'Профессиональная квалификация подтверждена', hasBachelorDegree: 'Есть диплом бакалавра', isItProfessional: 'IT-специалист', blueCardExceptionEligible: 'Есть основание для сниженного порога Blue Card', worksRemotelyForForeignEmployer: 'Работаю удалённо на иностранного работодателя', hasPrivateHealthInsurance: 'Есть подходящая медицинская страховка', remoteMonthlyIncomeIsNet: 'Удалённый доход указан после налогов' } as const;
const SCENARIOS = { domestic_market: 'Домашний рынок', employer_sponsorship: 'Работа со спонсорством', job_seeker_visa: 'Поиск работы на месте', digital_nomad: 'Digital Nomad', simple_mobility: 'Упрощённая мобильность' } as const;
type Props = { readonly countryCode: string; readonly income?: number; readonly profile: RelocationQuestionnaire | null; readonly onCountryChange: (code: string) => void; readonly onIncomeChange: (income: number | undefined) => void; readonly onIncomeModeChange: (mode: string) => void; };

function scenarioFingerprint(input: () => RelocationScenarioInput, revision: number | undefined) {
  try { return `${JSON.stringify(input())}:${revision ?? 0}`; } catch { return undefined; }
}

function useScenarioState(props: Props) {
  const [name, setName] = useState('Мой сценарий'); const [city, setCity] = useState('');
  const [householdSize, setHousehold] = useState(1); const [incomeMode, setMode] = useState<RelocationScenarioInput['incomeMode']>('local_employment');
  const [scenarioId, setScenario] = useState<RelocationScenarioInput['scenarioId']>('employer_sponsorship');
  const [expenses, setExpenses] = useState<RelocationScenarioInput['expenses']>({});
  const [upfront, setUpfront] = useState<RelocationScenarioInput['upfront']>({});
  const [proofOfFunds, setProof] = useState<RelocationCost>(); const [net, setNet] = useState<RelocationCost>();
  const [comparisonRate, setRate] = useState<RelocationCost>(); const [comparisonCurrency, setComparisonCurrency] = useState('EUR');
  const [reserveMonths, setReserve] = useState(3); const [usableFunds, setUsableFunds] = useState(false);
  const [visa, setVisa] = useState<RelocationScenarioInput['visa']>(() => relocationScenarioInputSchema.shape.visa.parse(relocationVisaProfile(props.profile)));
  const [options, setOptions] = useState<RelocationScenarioInput['payrollOptions']>({});
  const [resultKey, setResultKey] = useState<string>();
  const [result, setResult] = useState<RelocationScenarioResult>(); const [history, setHistory] = useState<SavedRelocationScenario[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [confirmDelete, setConfirmDelete] = useState<string>();
  const retry = useRef<{ body: string; key: string }>(); const mounted = useRef(true);
  const currency = props.countryCode ? getCountryTaxData(props.countryCode).currency : '';
  const refresh = async (offset = 0) => {
    try { const page = await listRelocationScenarios(offset); if (mounted.current) { setHistory((old) => offset ? [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()] : page.items); setNextOffset(page.nextOffset); } }
    catch (reason) { if (mounted.current) setError(apiErrorMessage(reason, 'Не удалось загрузить сохранённые расчёты.')); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void listRelocationScenarios().then((page) => { if (mounted.current) { setHistory(page.items); setNextOffset(page.nextOffset); } }).catch((reason: unknown) => { if (mounted.current) setError(apiErrorMessage(reason, 'Не удалось загрузить сохранённые расчёты.')); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, []);
  return { name, setName, city, setCity, householdSize, setHousehold, incomeMode, setMode, scenarioId, setScenario, expenses, setExpenses, upfront, setUpfront, proofOfFunds, setProof, net, setNet, comparisonRate, setRate, comparisonCurrency, setComparisonCurrency, reserveMonths, setReserve, usableFunds, setUsableFunds, visa, setVisa, options, setOptions, resultKey, setResultKey, result, setResult, history, setHistory, nextOffset, setNextOffset, selected, setSelected, busy, setBusy, loading, setLoading, error, setError, notice, setNotice, confirmDelete, setConfirmDelete, retry, mounted, currency, refresh };
}

export function RelocationScenarioPanel(props: Props) {
  const { name, setName, city, setCity, householdSize, setHousehold, incomeMode, setMode, scenarioId, setScenario, expenses, setExpenses, upfront, setUpfront, proofOfFunds, setProof, net, setNet, comparisonRate, setRate, comparisonCurrency, setComparisonCurrency, reserveMonths, setReserve, usableFunds, setUsableFunds, visa, setVisa, options, setOptions, resultKey, setResultKey, result, setResult, history, nextOffset, selected, setSelected, busy, setBusy, loading, error, setError, notice, setNotice, confirmDelete, setConfirmDelete, retry, mounted, currency, refresh } = useScenarioState(props);
  function input() { return relocationScenarioInputSchema.parse({ name, city, householdSize, countryCode: props.countryCode, grossAnnualIncome: props.income, incomeMode, scenarioId, expenses, upfront, reserveMonths, visa, proofOfFunds, proofFundsUsableForLiving: usableFunds, confirmedNetMonthly: incomeMode === 'local_employment' ? undefined : net, comparisonRate, payrollOptions: options }); }
  function calculate() {
    setError(''); setNotice('');
    try { const value = input(); retry.current = undefined; setResult(calculateRelocationScenario(value, props.profile)); setResultKey(`${JSON.stringify(value)}:${props.profile?.revision ?? 0}`); }
    catch { setError('Проверьте город, суммы, валюты, даты и источники. Для каждого расхода укажите сумму или оставьте его неизвестным.'); }
  }
  async function save() {
    setError(''); setNotice(''); let value: RelocationScenarioInput;
    try { value = input(); calculateRelocationScenario(value, props.profile); } catch { setError('Проверьте поля сценария и источники перед сохранением.'); return; }
    const body = JSON.stringify(value); if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try { const saved = await saveRelocationScenario(value, retry.current.key); if (mounted.current) { setResult(saved.result); setResultKey(`${JSON.stringify(saved.input)}:${saved.profileRevision ?? 0}`); setNotice('Расчёт сохранён в профиле.'); await refresh(); } }
    catch (reason) { if (mounted.current) setError(apiErrorMessage(reason, 'Не удалось сохранить. Повторите: повторный запрос не создаст дубликат.')); }
    finally { if (mounted.current) setBusy(false); }
  }
  function open(saved: SavedRelocationScenario) {
    const s = saved.input; props.onCountryChange(s.countryCode); props.onIncomeChange(s.grossAnnualIncome);
    setName(s.name); setCity(s.city); setHousehold(s.householdSize); setMode(s.incomeMode); props.onIncomeModeChange(s.incomeMode);
    setScenario(s.scenarioId); setExpenses(s.expenses); setUpfront(s.upfront); setProof(s.proofOfFunds); setNet(s.confirmedNetMonthly);
    setReserve(s.reserveMonths); setUsableFunds(s.proofFundsUsableForLiving); setVisa(s.visa); setOptions(s.payrollOptions);
    setRate(s.comparisonRate); setComparisonCurrency(s.comparisonRate?.currency ?? 'EUR'); setResult(saved.result); setResultKey(`${JSON.stringify(s)}:${saved.profileRevision ?? 0}`);
    retry.current = undefined; setNotice('Открыт сохранённый снимок. Пересчёт использует текущие правила; новая версия сохраняется отдельно.');
  }
  async function remove(id: string) { setBusy(true); try { await deleteRelocationScenario(id); setSelected((old) => old.filter((item) => item !== id)); setConfirmDelete(undefined); retry.current = undefined; setNotice('Расчёт удалён. Можно сохранить новую версию.'); await refresh(); } catch (reason) { setError(apiErrorMessage(reason, 'Не удалось удалить расчёт.')); } finally { if (mounted.current) setBusy(false); } }
  const currentKey = scenarioFingerprint(input, props.profile?.revision);
  const reference = relocationHousingReferences[props.countryCode];
  return <section className="career-relocation-scenarios" aria-label="Полный сценарий переезда">
    <h3>Полный сценарий переезда</h3><p>Все расходы указывайте для выбранного города и всей семьи. Пустое поле означает неизвестную сумму; 0 — проверенное отсутствие расхода. Страховые взносы, уже вычтенные из зарплаты, повторно не добавляйте.</p>
    <div className="career-relocation-economy-controls">
      <label><span>Название сценария</span><input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>Город расчёта</span><input maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} /></label>
      <label><span>Человек в бюджете</span><input type="number" min="1" max="20" value={householdSize} onChange={(e) => setHousehold(Number(e.target.value))} /></label>
      <label><span>Тип дохода</span><select value={incomeMode} onChange={(e) => { const mode = e.target.value as typeof incomeMode; setMode(mode); props.onIncomeModeChange(mode); setResult(undefined); }}><option value="local_employment">Зарплата у местного работодателя</option><option value="remote_employment">Иностранная удалённая работа</option><option value="self_employed">Самозанятость или бизнес</option></select></label>
      <label><span>Резерв на жизнь, месяцев</span><input type="number" min="0" max="36" value={reserveMonths} onChange={(e) => setReserve(Number(e.target.value))} /></label>
    </div>
    {incomeMode !== 'local_employment' && <><p>Зарплатная налоговая шкала не применяется к этому доходу. Укажите собственный расчёт чистого дохода с основанием; иначе остаток останется неизвестным.</p><ScenarioCostField label="Чистый доход" hidePayer currency={currency} value={net} onChange={setNet} /></>}
    <details><summary>Параметры зарплатной модели</summary>{(['germanyChildless', 'georgiaPensionParticipant', 'uaeNational'] as const).map((key) => <label key={key}>{({ germanyChildless: 'Германия: надбавка за бездетность', georgiaPensionParticipant: 'Грузия: участвую в пенсионной системе', uaeNational: 'Гражданин ОАЭ (модель взносов не поддерживается)' })[key]}<select value={options?.[key] === undefined ? '' : String(options[key])} onChange={(e) => setOptions({ ...options, [key]: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">По стандартным условиям модели</option><option value="true">Да</option><option value="false">Нет</option></select></label>)}</details>
    <details open><summary>Жильё и регулярные расходы</summary>{reference && <p><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a>: {reference.scope} Готовая цена не подставляется.</p>}{RELOCATION_EXPENSES.map((key) => <ScenarioCostField key={key} label={EXPENSE_LABELS[key]} currency={currency} value={expenses[key]} onChange={(value) => setExpenses({ ...expenses, [key]: value })} />)}</details>
    <details><summary>Разовые расходы и деньги на старт</summary>{RELOCATION_UPFRONT.map((key) => <ScenarioCostField key={key} label={UPFRONT_LABELS[key]} currency={currency} once value={upfront[key]} onChange={(value) => setUpfront({ ...upfront, [key]: value })} />)}<ScenarioCostField label="Средства для подтверждения визы" hidePayer currency={currency} once value={proofOfFunds} onChange={setProof} /><label><input type="checkbox" checked={usableFunds} onChange={(e) => setUsableFunds(e.target.checked)} />Подтверждённые средства доступны для расходов на жизнь; считаем их частью резерва</label></details>
    <details><summary>Условия визового маршрута</summary><label>Маршрут<select value={scenarioId} onChange={(e) => setScenario(e.target.value as typeof scenarioId)}>{Object.entries(SCENARIOS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><VisaCitizenships visa={visa} setVisa={setVisa} />{Object.entries(VISA_FLAGS).map(([key, label]) => <label key={key}>{label}<select value={visa[key as keyof typeof VISA_FLAGS] === undefined ? '' : String(visa[key as keyof typeof VISA_FLAGS])} onChange={(e) => setVisa({ ...visa, [key]: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">Неизвестно</option><option value="true">Да</option><option value="false">Нет</option></select></label>)}<label>Удалённый доход в месяц<input type="number" min="0" value={visa.remoteMonthlyIncome?.amount ?? ''} onChange={(e) => setVisa({ ...visa, remoteMonthlyIncome: e.target.value === '' ? undefined : { amount: Number(e.target.value), currency: visa.remoteMonthlyIncome?.currency ?? currency } })} /></label><label>Валюта удалённого дохода<input disabled={!visa.remoteMonthlyIncome} maxLength={3} value={visa.remoteMonthlyIncome?.currency ?? currency} onChange={(e) => setVisa({ ...visa, remoteMonthlyIncome: { amount: visa.remoteMonthlyIncome?.amount ?? 0, currency: e.target.value.toUpperCase() } })} /></label><label>Семейные сведения для визы<select value={visa.family ? visa.family.hasPartner ? 'partner' : 'single' : ''} onChange={(e) => setVisa({ ...visa, family: e.target.value === '' ? undefined : { hasPartner: e.target.value === 'partner', children: visa.family?.children ?? 0 } })}><option value="">Неизвестно</option><option value="single">Без партнёра</option><option value="partner">С партнёром</option></select></label><label>Детей для визового маршрута<input type="number" min="0" max="15" disabled={!visa.family} value={visa.family?.children ?? ''} onChange={(e) => visa.family && setVisa({ ...visa, family: { ...visa.family, children: Number(e.target.value) } })} /></label><label>Соответствующий опыт, лет<input type="number" min="0" max="80" value={visa.relevantExperienceYears ?? ''} onChange={(e) => setVisa({ ...visa, relevantExperienceYears: e.target.value === '' ? undefined : Number(e.target.value) })} /></label><RelocationVisaExtras visa={visa} setVisa={setVisa} country={props.countryCode} currency={currency} /></details>
    <details><summary>Курс для сравнения</summary><p>Суммы переводятся только по явно указанному курсу. Укажите, сколько единиц валюты сравнения приходится на 1 {currency}.</p><label>Валюта сравнения<input maxLength={3} value={comparisonCurrency} onChange={(e) => { setComparisonCurrency(e.target.value.toUpperCase()); setRate(undefined); }} /></label><ScenarioCostField label={`Курс за 1 ${currency}`} hidePayer currency={comparisonCurrency} once value={comparisonRate} onChange={setRate} /></details>
    <div className="career-relocation-list-footer"><button className="career-btn career-btn-secondary" type="button" onClick={() => { props.onIncomeChange(undefined); setExpenses({}); setUpfront({}); setProof(undefined); setNet(undefined); setRate(undefined); setResult(undefined); setCity(''); setName('Мой сценарий'); retry.current = undefined; setNotice('Новый сценарий: укажите город, доход и расходы. Чужая валюта не пересчитывается автоматически.'); }}>Начать новый сценарий</button><button className="career-btn career-btn-secondary" type="button" onClick={calculate}>Рассчитать сценарий</button><button className="career-btn career-btn-primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить расчёт в профиль'}</button></div>
    {error && <p className="career-relocation-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result && (currentKey === resultKey ? <RelocationScenarioResultView result={result} /> : <p role="status">Исходные данные изменены. Рассчитайте сценарий заново.</p>)}
    <section aria-label="Сохранённые расчёты"><h3>Сохранённые расчёты</h3>{loading ? <p role="status">Загружаем историю…</p> : history.length === 0 ? <p>Расчётов пока нет.</p> : <ul>{history.map((saved) => <li key={saved.id}><label><input type="checkbox" checked={selected.includes(saved.id)} disabled={!selected.includes(saved.id) && selected.length >= 3} onChange={(e) => setSelected((old) => e.target.checked ? [...old, saved.id] : old.filter((id) => id !== saved.id))} />В сравнение: {saved.input.name}</label><button className="career-btn career-btn-secondary" type="button" onClick={() => open(saved)}>Открыть: {saved.input.name}</button><button className="career-btn career-btn-secondary" type="button" onClick={() => setConfirmDelete(saved.id)}>Удалить: {saved.input.name}</button>{confirmDelete === saved.id && <div role="group" aria-label="Подтверждение удаления расчёта"><p>Удалить этот сохранённый расчёт?</p><button className="career-btn career-btn-secondary" type="button" onClick={() => setConfirmDelete(undefined)}>Оставить</button><button className="career-btn career-btn-secondary" type="button" disabled={busy} onClick={() => void remove(saved.id)}>Удалить расчёт</button></div>}</li>)}</ul>}<button className="career-btn career-btn-secondary" type="button" onClick={() => void refresh()}>Обновить историю</button>{nextOffset !== null && <button className="career-btn career-btn-secondary" type="button" onClick={() => void refresh(nextOffset)}>Показать ещё</button>}</section>
    {selected.length > 0 && <SavedScenarioComparison items={history.filter((s) => selected.includes(s.id))} />}
  </section>;
}
