import { useCallback, useEffect, useState } from 'react';
import type { CandidateCompanyFilter, CandidateCompanyOpportunity, CandidateCompanyPage } from '../../../shared/candidateCompany';
import {
  executeCompanyWantBulk,
  previewCompanyWantBulk,
  type CompanyWantBulkAction,
  type CompanyWantBulkItem,
} from './applicationsApi';
import {
  getCandidateCompanyPage,
  removeCandidateCompanyWant,
  saveCandidateCompanyNextStep,
  searchCandidateCompanyRecruiter,
  setCandidateCompanyWant,
} from '../vacancies/candidateCompaniesApi';

const FILTERS: readonly [CandidateCompanyFilter, string][] = [
  ['want', 'Хочу'], ['all', 'Новые вакансии'], ['recruiter', 'Ищу путь'], ['contacts', 'Есть контакты'],
];

interface CompanyWantsController {
  readonly filter: CandidateCompanyFilter;
  readonly setFilter: (filter: CandidateCompanyFilter) => void;
  readonly page?: CandidateCompanyPage;
  readonly loading: boolean;
  readonly error: string;
  readonly retry: () => void;
  readonly search: string;
  readonly draftSearch: string;
  readonly setDraftSearch: (value: string) => void;
  readonly applySearch: () => void;
  readonly steps: Readonly<Record<string, string>>;
  readonly setStep: (key: string, value: string) => void;
  readonly selected: readonly CompanyWantBulkItem[];
  readonly bulkAction: CompanyWantBulkAction;
  readonly setBulkAction: (action: CompanyWantBulkAction) => void;
  readonly bulkStep: string;
  readonly setBulkStep: (value: string) => void;
  readonly bulkPreviewCount: number | null;
  readonly bulkMessage: string;
  readonly setBulkMessage: (message: string) => void;
  readonly loadMore: () => void;
  readonly toggleSelected: (company: CandidateCompanyOpportunity) => void;
  readonly toggleWant: (company: CandidateCompanyOpportunity) => void;
  readonly saveStep: (company: CandidateCompanyOpportunity) => void;
  readonly findRecruiter: (company: CandidateCompanyOpportunity) => void;
  readonly selectAllFiltered: () => void;
  readonly previewBulk: () => void;
  readonly applyBulk: () => void;
}

export function CompanyWantsPanel() {
  const controller = useCompanyWantsController();
  return (
    <section className="career-responses-company-wants" aria-label="Компании, которые интересуют">
      <CompanyWantsHeader controller={controller} />
      <CompanyWantsSearch controller={controller} />
      <CompanyWantsFilters controller={controller} />
      <CompanyWantsBulkActions controller={controller} />
      <CompanyWantsStatus controller={controller} />
      <CompanyWantsList controller={controller} />
      {controller.page && controller.page.items.length < controller.page.total ? <button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={controller.loadMore}>Показать ещё</button> : null}
    </section>
  );
}

function useCompanyWantsController(): CompanyWantsController {
  const [filter, setFilter] = useState<CandidateCompanyFilter>('want');
  const [page, setPage] = useState<CandidateCompanyPage>();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [steps, setSteps] = useState<Readonly<Record<string, string>>>({});
  const [selected, setSelected] = useState<readonly CompanyWantBulkItem[]>([]);
  const [bulkMessage, setBulkMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const actions = useCompanyWantActions(filter, search, steps, setSteps, setError, () => loadPage());
  const bulk = useCompanyWantBulk(filter, search, page, selected, setSelected, setError, () => loadPage(), bulkMessage, setBulkMessage);
  const [bulkAction, setBulkAction] = useState<CompanyWantBulkAction>('add');
  const [bulkStep, setBulkStep] = useState('');
  const [bulkPreviewCount, setBulkPreviewCount] = useState<number | null>(null);
  const loadPage = useCallback(async (nextOffset = 0) => {
    await loadCompanyPage(filter, search, nextOffset, setPage, setOffset, setLoading, setError);
  }, [filter, search]);
  useEffect(() => { void loadPage(); }, [loadPage]);
  const toggleSelected = useCallback((company: CandidateCompanyOpportunity) => {
    setSelected((current) => toggleCompanySelection(current, company));
  }, []);
  return {
    filter, setFilter, page, loading, error, retry: () => { void loadPage(offset); }, search, draftSearch,
    setDraftSearch, applySearch: () => { setOffset(0); setSearch(draftSearch.trim()); }, steps,
    setStep: (key, value) => setSteps((current) => ({ ...current, [key]: value })), selected,
    bulkAction, setBulkAction, bulkStep, setBulkStep, bulkPreviewCount, bulkMessage, setBulkMessage,
    loadMore: () => { void loadPage(offset + 20); }, toggleSelected, toggleWant: actions.toggleWant,
    saveStep: actions.saveStep, findRecruiter: actions.findRecruiter, selectAllFiltered: bulk.selectAllFiltered,
    previewBulk: () => void previewCompanyBulkAction(selected, bulkAction, bulkStep, setBulkPreviewCount, setBulkMessage, setError),
    applyBulk: () => void applyCompanyBulkAction(selected, bulkAction, bulkStep, bulkPreviewCount, setSelected, setBulkPreviewCount, setBulkMessage, setError, loadPage),
  };
}

function useCompanyWantActions(
  filter: CandidateCompanyFilter,
  search: string,
  steps: Readonly<Record<string, string>>,
  setSteps: (steps: Readonly<Record<string, string>>) => void,
  setError: (message: string) => void,
  reload: () => Promise<void>,
) {
  const toggleWant = useCallback((company: CandidateCompanyOpportunity) => {
    void mutateCompanyWant(company, setError, reload);
  }, [setError, reload]);
  const saveStep = useCallback((company: CandidateCompanyOpportunity) => {
    void persistCompanyStep(company, steps[company.key] ?? company.nextStep?.text ?? '', setError, reload);
  }, [steps, setError, reload]);
  const findRecruiter = useCallback((company: CandidateCompanyOpportunity) => {
    void queueRecruiterSearch(company, setError, reload);
  }, [setError, reload]);
  return { filter, search, setSteps, toggleWant, saveStep, findRecruiter };
}

function useCompanyWantBulk(
  filter: CandidateCompanyFilter,
  search: string,
  page: CandidateCompanyPage | undefined,
  selected: readonly CompanyWantBulkItem[],
  setSelected: (items: readonly CompanyWantBulkItem[]) => void,
  setError: (message: string) => void,
  reload: () => Promise<void>,
  message: string,
  setMessage: (value: string) => void,
) {
  const selectAllFiltered = useCallback(() => {
    if (page) void selectCompaniesByFilter(filter, search, page.total, setSelected, setMessage, setError);
  }, [filter, search, page, setSelected, setMessage, setError]);
  return { selected, message, reload, selectAllFiltered };
}

function CompanyWantsHeader({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <header className="career-responses-company-header">
      <div><h2>Хочу в компанию</h2><p>{controller.page?.total ?? 0} компаний в текущем списке</p></div>
      <button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={() => controller.setFilter(controller.filter === 'want' ? 'all' : 'want')}>
        {controller.filter === 'want' ? 'Добавить компании' : 'Мой список'}
      </button>
    </header>
  );
}

function CompanyWantsSearch({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <form className="career-responses-company-search" onSubmit={(event) => { event.preventDefault(); controller.applySearch(); }}>
      <label htmlFor="responses-company-search">Найти компанию</label>
      <input id="responses-company-search" value={controller.draftSearch} onChange={(event) => controller.setDraftSearch(event.currentTarget.value)} />
      <button type="submit" className="career-btn career-btn-secondary career-btn-sm">Найти</button>
    </form>
  );
}

function CompanyWantsFilters({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <div className="career-responses-company-filters" role="tablist" aria-label="Статус компаний">
      {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={controller.filter === value} onClick={() => controller.setFilter(value)}>{label}{controller.page?.filterCounts[value] !== undefined ? ` ${controller.page.filterCounts[value] ?? ''}` : ''}</button>)}
    </div>
  );
}

function CompanyWantsBulkActions({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <div className="career-responses-company-bulk">
      <button type="button" onClick={controller.selectAllFiltered} disabled={!controller.page || controller.loading}>Выбрать все {controller.page?.total ?? 0} по фильтру</button>
      {controller.selected.length ? <span role="status">Выбрано {controller.selected.length}</span> : null}
      <label>Массовое действие<select value={controller.bulkAction} onChange={(event) => controller.setBulkAction(event.currentTarget.value as CompanyWantBulkAction)}><option value="add">Добавить в «Хочу»</option><option value="remove">Убрать из «Хочу»</option><option value="set_next_step">Сохранить следующий шаг</option></select></label>
      {controller.bulkAction === 'set_next_step' ? <input value={controller.bulkStep} onChange={(event) => controller.setBulkStep(event.currentTarget.value)} maxLength={180} placeholder="Следующий шаг" /> : null}
      <button type="button" onClick={controller.previewBulk} disabled={!controller.selected.length || (controller.bulkAction === 'set_next_step' && !controller.bulkStep.trim())}>Проверить</button>
      {controller.bulkPreviewCount !== null ? <button type="button" onClick={controller.applyBulk}>Подтвердить {controller.bulkPreviewCount}</button> : null}
      {controller.bulkMessage ? <span role="status">{controller.bulkMessage}</span> : null}
    </div>
  );
}

function CompanyWantsStatus({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <>
      {controller.error ? <p role="alert">{controller.error} <button type="button" onClick={controller.retry}>Повторить</button></p> : null}
      {controller.loading && !controller.page ? <p role="status">Загружаем компании…</p> : null}
      {!controller.loading && controller.page?.items.length === 0 ? <p role="status">Компаний по этому фильтру пока нет.</p> : null}
      {controller.loading && controller.page ? <p role="status">Обновляем список…</p> : null}
    </>
  );
}

function CompanyWantsList({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <ul className="career-responses-company-list">
      {controller.page?.items.map((company) => <CompanyWantRow key={company.key} company={company} selected={controller.selected.some((item) => item.companyName === company.name)} onSelect={() => controller.toggleSelected(company)} step={controller.steps[company.key] ?? company.nextStep?.text ?? ''} onStepChange={(value) => controller.setStep(company.key, value)} onToggleWant={() => controller.toggleWant(company)} onSaveStep={() => controller.saveStep(company)} onFindRecruiter={() => controller.findRecruiter(company)} />)}
    </ul>
  );
}

function CompanyWantRow({
  company,
  selected,
  onSelect,
  step,
  onStepChange,
  onToggleWant,
  onSaveStep,
  onFindRecruiter,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly step: string;
  readonly onStepChange: (value: string) => void;
  readonly onToggleWant: () => void;
  readonly onSaveStep: () => void;
  readonly onFindRecruiter: () => void;
}) {
  return (
    <li className="career-responses-company-row">
      <label className="career-responses-company-select"><input type="checkbox" checked={selected} onChange={onSelect} />Выбрать</label>
      <div className="career-responses-company-main"><strong>{company.name}</strong><span>{company.location || 'Локация не указана'} · {company.vacancyCount} вакансий</span><span>{companyStatus(company)}</span></div>
      <div className="career-responses-company-actions"><button type="button" onClick={onToggleWant}>{company.want ? 'Убрать из списка' : 'Хочу в компанию'}</button><button type="button" onClick={onFindRecruiter} disabled={company.recruiterSearchStatus === 'queued' || company.recruiterSearchStatus === 'running'}>{company.recruiterSearchStatus === 'ready' ? 'Обновить путь' : 'Найти путь к рекрутеру'}</button></div>
      <label className="career-responses-company-step">Следующий шаг<input value={step} onChange={(event) => onStepChange(event.currentTarget.value)} maxLength={180} /></label>
      <button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={onSaveStep} disabled={!step.trim()}>Сохранить шаг</button>
    </li>
  );
}

async function loadCompanyPage(
  filter: CandidateCompanyFilter,
  search: string,
  offset: number,
  setPage: (updater: (current: CandidateCompanyPage | undefined) => CandidateCompanyPage) => void,
  setOffset: (offset: number) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string) => void,
) {
  setLoading(true); setError('');
  try {
    const result = await getCandidateCompanyPage({ filter, offset, search });
    setPage((current) => offset ? { ...result, items: [...(current?.items ?? []), ...result.items] } : result);
    setOffset(offset);
  } catch {
    setError('Не удалось загрузить список компаний. Повторите запрос.');
  } finally { setLoading(false); }
}

async function mutateCompanyWant(company: CandidateCompanyOpportunity, setError: (error: string) => void, reload: () => Promise<void>) {
  try { if (company.want) await removeCandidateCompanyWant(company.key); else await setCandidateCompanyWant(company.key); await reload(); }
  catch { setError('Не удалось изменить список компаний. Повторите запрос.'); }
}

async function persistCompanyStep(company: CandidateCompanyOpportunity, text: string, setError: (error: string) => void, reload: () => Promise<void>) {
  if (!text.trim()) return;
  try { await saveCandidateCompanyNextStep(company.key, text.trim(), null); await reload(); }
  catch { setError('Не удалось сохранить следующий шаг. Повторите запрос.'); }
}

async function queueRecruiterSearch(company: CandidateCompanyOpportunity, setError: (error: string) => void, reload: () => Promise<void>) {
  try { await searchCandidateCompanyRecruiter(company.key); await reload(); }
  catch { setError('Поиск контакта не выполнен. Проверьте доступность подключений и повторите.'); }
}

async function selectCompaniesByFilter(filter: CandidateCompanyFilter, search: string, total: number, setSelected: (items: readonly CompanyWantBulkItem[]) => void, setMessage: (message: string) => void, setError: (message: string) => void) {
  try {
    const items: CompanyWantBulkItem[] = [];
    for (let offset = 0; offset < Math.min(total, 100); offset += 20) {
      const page = await getCandidateCompanyPage({ filter, offset, search });
      items.push(...page.items.map((company) => ({ companyName: company.name })));
    }
    setSelected(items); setMessage(total > 100 ? `Выбраны первые ${items.length} из ${total} компаний.` : `Выбрано ${items.length} компаний.`);
  } catch { setError('Не удалось собрать компании по фильтру. Повторите запрос.'); }
}

async function previewCompanyBulkAction(selected: readonly CompanyWantBulkItem[], action: CompanyWantBulkAction, step: string, setCount: (count: number | null) => void, setMessage: (message: string) => void, setError: (message: string) => void) {
  if (!selected.length) return;
  try { const result = await previewCompanyWantBulk(action, withBulkStep(selected, action, step)); setCount(result.affectedCount); setMessage(''); }
  catch { setError('Не удалось проверить список компаний для массового действия.'); }
}

async function applyCompanyBulkAction(selected: readonly CompanyWantBulkItem[], action: CompanyWantBulkAction, step: string, count: number | null, setSelected: (items: readonly CompanyWantBulkItem[]) => void, setCount: (count: number | null) => void, setMessage: (message: string) => void, setError: (message: string) => void, reload: () => Promise<void>) {
  if (count === null || !selected.length) return;
  try { const result = await executeCompanyWantBulk(action, withBulkStep(selected, action, step), count); setMessage(`Изменено компаний: ${result.changedCount}.`); setSelected([]); setCount(null); await reload(); }
  catch { setError('Состав списка изменился. Обновите данные и проверьте действие повторно.'); setCount(null); }
}

function withBulkStep(items: readonly CompanyWantBulkItem[], action: CompanyWantBulkAction, step: string): CompanyWantBulkItem[] {
  return items.map((item) => ({ ...item, ...(action === 'set_next_step' ? { nextStep: step.trim() } : {}) }));
}

function toggleCompanySelection(current: readonly CompanyWantBulkItem[], company: CandidateCompanyOpportunity): readonly CompanyWantBulkItem[] {
  return current.some((item) => item.companyName === company.name)
    ? current.filter((item) => item.companyName !== company.name)
    : [...current, { companyName: company.name }];
}

function companyStatus(company: CandidateCompanyOpportunity): string {
  if (company.recruiterSearchStatus === 'queued' || company.recruiterSearchStatus === 'running') return 'Ищем путь к рекрутеру';
  if (company.hasRecruiter) return 'Есть контакт рекрутера';
  if (company.nextStep) return 'Следующий шаг сохранён';
  return company.want ? 'В списке «Хочу»' : 'Новые вакансии';
}
