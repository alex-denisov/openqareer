import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  DotsThree,
  Info,
  Lightbulb,
  MagnifyingGlass,
  Path,
  Plus,
  Trash,
  Upload,
} from '@phosphor-icons/react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantSelectionItem,
  CandidateCompanyWantStage,
  CandidateCompanyWantStageFilter,
} from '../../../shared/candidateCompany';
import { AddCompaniesDialog, NextStepDialog } from './CompanyWantsDialogs';
import { CompanyWantsMenu, type CompanyWantsMenuItem } from './CompanyWantsMenu';
import { CompanyWantsMobile } from './CompanyWantsMobile';
import { COMPANY_WANT_PAGE_SIZE } from './companyWantsApi';
import { WANT_STAGE_LABELS, nextStepText, toSelectionItem } from './companyWantsModel';
import { useCompanyWants, type CompanyWantsController } from './useCompanyWants';
import { useWantTabSuggestion } from './useWantTabSuggestion';
import './responses-company-wants.css';

type Selection = readonly CandidateCompanyWantSelectionItem[];

interface StepTarget {
  readonly items: Selection;
  readonly initial: string;
}

export interface CompanyWantsView {
  readonly controller: CompanyWantsController;
  readonly openAdd: () => void;
  readonly openNextStep: (items: Selection) => void;
}

const STAGE_CHIPS: readonly [CandidateCompanyWantStageFilter, string][] = [
  ['all', 'всего'],
  ['new', 'новые вакансии'],
  ['want', 'хочу'],
  ['path', 'ищу путь'],
  ['waiting', 'жду вакансию'],
];

export function StageIcon({ stage }: { readonly stage: CandidateCompanyWantStage }) {
  if (stage === 'path') return <Path aria-hidden="true" />;
  if (stage === 'waiting') return <Clock aria-hidden="true" />;
  return <Lightbulb aria-hidden="true" />;
}

export function stageMenuItems(
  controller: CompanyWantsController,
  items: Selection,
  openNextStep: (items: Selection) => void,
): CompanyWantsMenuItem[] {
  const stages: CandidateCompanyWantStage[] = ['want', 'path', 'waiting'];
  return [
    ...stages.map((stage) => ({
      label: WANT_STAGE_LABELS[stage],
      icon: <StageIcon stage={stage} />,
      onSelect: () => controller.changeStage(items, stage),
    })),
    {
      label: 'Следующий шаг…',
      icon: <ArrowsClockwise aria-hidden="true" />,
      onSelect: () => openNextStep(items),
    },
  ];
}

export function CompanyWantsPanel() {
  const controller = useCompanyWants();
  const [addOpen, setAddOpen] = useState(false);
  const [stepTarget, setStepTarget] = useState<StepTarget | null>(null);
  useWantTabSuggestion(controller, () => setAddOpen(true));
  const view: CompanyWantsView = {
    controller,
    openAdd: () => setAddOpen(true),
    openNextStep: (items) =>
      setStepTarget({ items, initial: items.length === 1 ? (items[0]?.nextStep ?? '') : '' }),
  };
  return (
    <section className="career-company-wants" aria-label="Хочу в компанию">
      <div className="career-company-wants-desk">
        <StageChips controller={controller} />
        <FilterTools view={view} />
        <SelectionBar controller={controller} />
        <BulkActions view={view} />
        <Feedback controller={controller} />
        <CompanyTable view={view} />
        <TableFooter controller={controller} />
        <div className="career-company-wants-note">
          <Info aria-hidden="true" />
          <span>
            Добавлять можно тремя способами: из вакансий кнопкой «Хочу в эту компанию» (в том числе
            все компании подборки сразу), по названию и списком из файла или вставкой, до 500
            компаний за раз.
          </span>
        </div>
      </div>
      <CompanyWantsMobile view={view} />
      {addOpen ? (
        <AddCompaniesDialog
          busy={controller.busy}
          onAdd={controller.addCompanies}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
      {stepTarget ? (
        <NextStepDialog
          count={stepTarget.items.length}
          initial={stepTarget.initial}
          onSave={(text) => controller.changeNextStep(stepTarget.items, text)}
          onClose={() => setStepTarget(null)}
        />
      ) : null}
    </section>
  );
}

function StageChips({ controller }: { readonly controller: CompanyWantsController }) {
  const counts = controller.page?.counts;
  return (
    <div className="career-company-wants-stages" role="group" aria-label="Статус, фильтр">
      {STAGE_CHIPS.map(([stage, label]) => (
        <button
          key={stage}
          type="button"
          className={stage === 'new' ? 'is-hot' : undefined}
          aria-pressed={controller.query.stage === stage}
          onClick={() => controller.setQuery({ stage })}
        >
          <span className="career-company-wants-num">{counts ? counts[stage] : '–'}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ContractSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="career-company-wants-field">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <span className="career-company-wants-select-wrap">
        <select
          id={id}
          className="career-company-wants-select"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {children}
        </select>
        <CaretDown className="career-company-wants-caret" aria-hidden="true" />
      </span>
    </div>
  );
}

function FilterTools({ view }: { readonly view: CompanyWantsView }) {
  return (
    <div className="career-company-wants-tools">
      <SearchField controller={view.controller} />
      <FilterSelects controller={view.controller} />
      <button type="button" className="career-btn career-btn-secondary" onClick={view.openAdd}>
        <Plus aria-hidden="true" />
        Добавить компании
      </button>
    </div>
  );
}

function SearchField({ controller }: { readonly controller: CompanyWantsController }) {
  return (
    <div className="career-company-wants-field is-search">
      <label className="sr-only" htmlFor="company-wants-search">
        Поиск
      </label>
      <span className="career-company-wants-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          id="company-wants-search"
          className="career-company-wants-input"
          placeholder="Название компании или отрасль"
          value={controller.draftSearch}
          onChange={(event) => controller.setDraftSearch(event.currentTarget.value)}
        />
      </span>
    </div>
  );
}

function FilterSelects({ controller }: { readonly controller: CompanyWantsController }) {
  const { query } = controller;
  return (
    <>
      <ContractSelect
        id="company-wants-industry"
        label="Отрасль"
        value={query.industry}
        onChange={(industry) => controller.setQuery({ industry })}
      >
        <option value="">Все отрасли</option>
        {(controller.page?.industries ?? []).map((industry) => (
          <option key={industry} value={industry}>
            {industry}
          </option>
        ))}
      </ContractSelect>
      <ContractSelect
        id="company-wants-contacts"
        label="Контакты"
        value={query.contacts}
        onChange={(contacts) =>
          controller.setQuery({ contacts: contacts as typeof query.contacts })
        }
      >
        <option value="any">Любые</option>
        <option value="with">Есть контакт в сети</option>
        <option value="without">Контактов нет</option>
      </ContractSelect>
      <ContractSelect
        id="company-wants-sort"
        label="Сортировка"
        value={query.sort}
        onChange={(sort) => controller.setQuery({ sort: sort as typeof query.sort })}
      >
        <option value="vacancies">По числу вакансий</option>
        <option value="alphabetical">По названию</option>
        <option value="added">По дате добавления</option>
      </ContractSelect>
    </>
  );
}

function SelectionBar({ controller }: { readonly controller: CompanyWantsController }) {
  const total = controller.page?.total ?? 0;
  const allSelected = total > 0 && controller.selected.length >= Math.min(total, 500);
  return (
    <div className="career-company-wants-selection" role="status">
      <CheckCircle aria-hidden="true" />
      <span>
        Выбрано <span className="career-company-wants-num">{controller.selected.length}</span> из{' '}
        <span className="career-company-wants-num">{total}</span>
      </span>
      <button
        type="button"
        className="career-company-wants-link"
        disabled={controller.busy || total === 0}
        onClick={allSelected ? controller.clearSelection : controller.selectAllByFilter}
      >
        {allSelected ? 'Снять выбор' : `Выбрать все ${total} по фильтру`}
      </button>
    </div>
  );
}

function BulkActions({ view }: { readonly view: CompanyWantsView }) {
  const { controller } = view;
  const items = controller.selected;
  const disabled = controller.busy || items.length === 0;
  return (
    <div className="career-company-wants-bulk" role="group" aria-label="Действия с выбранными">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={disabled}
        onClick={() => controller.findPaths(items)}
      >
        <Path aria-hidden="true" />
        Найти пути
      </button>
      <CompanyWantsMenu
        trigger={
          <>
            <ArrowsClockwise aria-hidden="true" />
            Сменить статус
          </>
        }
        triggerClassName="career-btn career-btn-secondary career-btn-sm"
        disabled={disabled}
        items={stageMenuItems(controller, items, view.openNextStep)}
      />
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={disabled}
        onClick={() => controller.exportItems(items)}
      >
        <Upload aria-hidden="true" />
        Экспорт
      </button>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={disabled}
        onClick={() => controller.requestRemoval(items)}
      >
        <Trash aria-hidden="true" />
        Убрать из «Хочу»
      </button>
    </div>
  );
}

export function Feedback({ controller }: { readonly controller: CompanyWantsController }) {
  const pending = controller.pendingRemoval;
  return (
    <>
      {pending ? (
        <div className="career-company-wants-confirm" role="alertdialog" aria-label="Подтверждение">
          <span>
            Убрать из «Хочу» компаний: {pending.items.length}? Оповещения по ним прекратятся.
          </span>
          <button
            type="button"
            className="career-btn career-btn-primary career-btn-sm"
            onClick={controller.confirmRemoval}
          >
            Убрать
          </button>
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-sm"
            onClick={controller.cancelRemoval}
          >
            Отмена
          </button>
        </div>
      ) : null}
      {controller.error ? (
        <p className="career-company-wants-error" role="alert">
          {controller.error}{' '}
          <button type="button" className="career-company-wants-link" onClick={controller.retry}>
            Повторить
          </button>
        </p>
      ) : null}
      {controller.message ? (
        <p className="career-company-wants-message" role="status">
          {controller.message}
        </p>
      ) : null}
    </>
  );
}

export function rowMenuItems(
  view: CompanyWantsView,
  company: CandidateCompanyOpportunity,
): CompanyWantsMenuItem[] {
  const { controller } = view;
  const item = [toSelectionItem(company)];
  const searching =
    company.recruiterSearchStatus === 'queued' || company.recruiterSearchStatus === 'running';
  return [
    {
      label: company.hasRecruiter ? 'Обновить путь' : 'Найти путь',
      icon: <Path aria-hidden="true" />,
      disabled: searching || company.vacancyCount === 0,
      onSelect: () => controller.findPaths(item),
    },
    ...stageMenuItems(controller, item, view.openNextStep),
    {
      label: 'Убрать из «Хочу»',
      icon: <Trash aria-hidden="true" />,
      onSelect: () => controller.requestRemoval(item),
    },
  ];
}

function CompanyTable({ view }: { readonly view: CompanyWantsView }) {
  const { controller } = view;
  const items = controller.items;
  const pageSelected =
    items.length > 0 && items.every((company) => controller.isSelected(company.key));
  return (
    <div className="career-company-wants-table-wrap">
      <table className="career-company-wants-table">
        <thead>
          <tr>
            <th className="is-check">
              <CheckBox
                checked={pageSelected}
                label="Выбрать страницу"
                onChange={controller.togglePage}
              />
            </th>
            <th>Компания</th>
            <th>Статус</th>
            <th>Вакансий</th>
            <th>Контактов</th>
            <th>Следующий шаг</th>
            <th>
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((company) => (
            <CompanyRow key={company.key} view={view} company={company} />
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="career-company-wants-empty">
                <span role="status">{emptyText(controller)}</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function emptyText(controller: CompanyWantsController): string {
  if (controller.loading) return 'Загружаем компании…';
  if ((controller.page?.counts.all ?? 0) === 0)
    return 'В «Хочу» пока нет компаний. Добавьте их по названию, списком или из вакансий.';
  return 'Компаний по этому фильтру нет.';
}

function CompanyRow({
  view,
  company,
}: {
  readonly view: CompanyWantsView;
  readonly company: CandidateCompanyOpportunity;
}) {
  const selected = view.controller.isSelected(company.key);
  const stage = company.wantStage ?? 'want';
  return (
    <tr className={selected ? 'is-selected' : undefined}>
      <td className="is-check">
        <CheckBox
          checked={selected}
          label={`Выбрать ${company.name}`}
          onChange={() => view.controller.toggleOne(company)}
        />
      </td>
      <td>
        <b>{company.name}</b>
        {company.industry ? (
          <span className="career-company-wants-muted">{company.industry}</span>
        ) : null}
      </td>
      <td>
        <span className={`career-company-wants-tag is-${stage}`}>
          <StageIcon stage={stage} />
          {WANT_STAGE_LABELS[stage]}
        </span>
      </td>
      <td className="career-company-wants-num">{company.vacancyCount}</td>
      <td className="career-company-wants-num">{company.contactsCount ?? '–'}</td>
      <td>{nextStepText(company)}</td>
      <td className="is-menu">
        <CompanyWantsMenu
          trigger={<DotsThree aria-hidden="true" />}
          triggerClassName="career-company-wants-icon-btn"
          triggerLabel={`Действия: ${company.name}`}
          items={rowMenuItems(view, company)}
        />
      </td>
    </tr>
  );
}

function CheckBox({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: () => void;
}) {
  return (
    <label className="career-company-wants-check">
      <input type="checkbox" checked={checked} aria-label={label} onChange={onChange} />
      <Check className="career-company-wants-check-mark" aria-hidden="true" />
    </label>
  );
}

function TableFooter({ controller }: { readonly controller: CompanyWantsController }) {
  const shown = controller.items.length;
  const total = controller.page?.total ?? 0;
  if (total === 0) return null;
  return (
    <div className="career-company-wants-footer">
      <span>
        Показано <span className="career-company-wants-num">{shown}</span> из{' '}
        <span className="career-company-wants-num">{total}</span>
      </span>
      {shown < total ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          disabled={controller.loading}
          onClick={controller.loadMore}
        >
          Показать ещё {Math.min(COMPANY_WANT_PAGE_SIZE, total - shown)}
        </button>
      ) : null}
    </div>
  );
}
