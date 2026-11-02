import { useState } from 'react';
import { CaretDown, CaretRight, Check, Path, Plus, Trash, Upload } from '@phosphor-icons/react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantSelectionItem,
} from '../../../shared/candidateCompany';
import { CompanyWantsMenu, type CompanyWantsMenuItem } from './CompanyWantsMenu';
import { COMPANY_WANT_BULK_LIMIT, COMPANY_WANT_PAGE_SIZE } from './companyWantsApi';
import { WANT_STAGE_LABELS, nextStepText } from './companyWantsModel';
import {
  Feedback,
  StageIcon,
  emptyText,
  rowMenuItems,
  stageMenuItems,
  type CompanyWantsView,
} from './ResponsesCompanyWants';

type Selection = readonly CandidateCompanyWantSelectionItem[];

/** 390: grouped list from the mockup (vt=w) — selection mode, rows, «Показать ещё», add row. */
export function CompanyWantsMobile({ view }: { readonly view: CompanyWantsView }) {
  const { controller } = view;
  const [selecting, setSelecting] = useState(false);
  const total = controller.page?.total ?? 0;
  return (
    <div className="career-company-wants-mob">
      {selecting ? (
        <MobileSelectionBar
          view={view}
          onDone={() => {
            setSelecting(false);
            controller.clearSelection();
          }}
        />
      ) : (
        <div className="career-company-wants-sum">
          <p>
            <b className="career-company-wants-num">{total}</b> компаний ·{' '}
            <span className="career-company-wants-num">{controller.page?.counts.new ?? 0}</span> с
            новыми вакансиями
          </p>
          <button
            type="button"
            className="career-company-wants-text-btn"
            disabled={total === 0}
            onClick={() => setSelecting(true)}
          >
            Выбрать
          </button>
        </div>
      )}
      <Feedback controller={controller} />
      <MobileList view={view} selecting={selecting} />
      <AddRow onAdd={view.openAdd} />
    </div>
  );
}

function MobileList({
  view,
  selecting,
}: {
  readonly view: CompanyWantsView;
  readonly selecting: boolean;
}) {
  const { controller } = view;
  const total = controller.page?.total ?? 0;
  const shown = controller.items.length;
  return (
    <>
      <div className="career-company-wants-cards">
        {controller.items.map((company) => (
          <MobileRow key={company.key} view={view} company={company} selecting={selecting} />
        ))}
        {shown === 0 ? (
          <p className="career-company-wants-foot" role="status">
            {emptyText(controller)}
          </p>
        ) : null}
      </div>
      {total > 0 ? (
        <p className="career-company-wants-foot">
          Показано <span className="career-company-wants-num">{shown}</span> из{' '}
          <span className="career-company-wants-num">{total}</span>.
        </p>
      ) : null}
      {shown < total ? (
        <button
          type="button"
          className="career-company-wants-quiet-cta"
          disabled={controller.loading}
          onClick={controller.loadMore}
        >
          Показать ещё {Math.min(COMPANY_WANT_PAGE_SIZE, total - shown)}
        </button>
      ) : null}
    </>
  );
}

function AddRow({ onAdd }: { readonly onAdd: () => void }) {
  return (
    <div className="career-company-wants-group">
      <button type="button" className="career-company-wants-add-row" onClick={onAdd}>
        <span className="career-company-wants-add-ico">
          <Plus aria-hidden="true" />
        </span>
        <span className="career-company-wants-add-main">
          <b>Добавить компании</b>
          <small>по названию, списком из файла или вставкой, до 500</small>
        </span>
        <CaretRight className="career-company-wants-chev" aria-hidden="true" />
      </button>
    </div>
  );
}

function mobileActions(view: CompanyWantsView, items: Selection): CompanyWantsMenuItem[] {
  const { controller } = view;
  return [
    {
      label: 'Найти пути',
      icon: <Path aria-hidden="true" />,
      onSelect: () => controller.findPaths(items),
    },
    ...stageMenuItems(controller, items, view.openNextStep),
    {
      label: 'Экспорт',
      icon: <Upload aria-hidden="true" />,
      onSelect: () => controller.exportItems(items),
    },
    {
      label: 'Убрать из «Хочу»',
      icon: <Trash aria-hidden="true" />,
      onSelect: () => controller.requestRemoval(items),
    },
  ];
}

function MobileSelectionBar({
  view,
  onDone,
}: {
  readonly view: CompanyWantsView;
  readonly onDone: () => void;
}) {
  const { controller } = view;
  const items = controller.selected;
  const total = controller.page?.total ?? 0;
  const all = total > 0 && items.length >= Math.min(total, COMPANY_WANT_BULK_LIMIT);
  return (
    <div className="career-company-wants-selbar">
      <button type="button" className="career-company-wants-text-btn" onClick={onDone}>
        Отмена
      </button>
      <button
        type="button"
        className="career-company-wants-text-btn"
        aria-pressed={all}
        disabled={controller.busy}
        onClick={all ? controller.clearSelection : controller.selectAllByFilter}
      >
        Все
      </button>
      <span className="career-company-wants-selcount">
        Выбрано <b className="career-company-wants-num">{items.length}</b>
      </span>
      <CompanyWantsMenu
        trigger={
          <>
            Действия
            <CaretDown aria-hidden="true" />
          </>
        }
        triggerClassName="career-company-wants-act"
        disabled={controller.busy || items.length === 0}
        items={mobileActions(view, items)}
      />
    </div>
  );
}

function MobileRowBody({
  company,
  selecting,
  selected,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly selecting: boolean;
  readonly selected: boolean;
}) {
  const stage = company.wantStage ?? 'want';
  return (
    <>
      <div className="career-company-wants-r1">
        {selecting ? (
          <span
            className={selected ? 'career-company-wants-ck is-on' : 'career-company-wants-ck'}
            aria-hidden="true"
          >
            {selected ? <Check /> : null}
          </span>
        ) : null}
        <b>{company.name}</b>
        <span className="career-company-wants-due career-company-wants-num">
          {company.vacancyCount} ваканс.
        </span>
      </div>
      <small className="career-company-wants-r2">
        {[
          company.industry,
          company.contactsCount === null ? null : `контактов ${company.contactsCount}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </small>
      <div className="career-company-wants-r3">
        <span className={`career-company-wants-tag is-${stage}`}>
          <StageIcon stage={stage} />
          {WANT_STAGE_LABELS[stage]}
        </span>
        <span className="career-company-wants-next">{nextStepText(company)}</span>
      </div>
    </>
  );
}

function MobileRow({
  view,
  company,
  selecting,
}: {
  readonly view: CompanyWantsView;
  readonly company: CandidateCompanyOpportunity;
  readonly selecting: boolean;
}) {
  const selected = view.controller.isSelected(company.key);
  const body = <MobileRowBody company={company} selecting={selecting} selected={selected} />;
  if (selecting) {
    return (
      <button
        type="button"
        className={selected ? 'career-company-wants-card is-selected' : 'career-company-wants-card'}
        aria-pressed={selected}
        onClick={() => view.controller.toggleOne(company)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="career-company-wants-card">
      {body}
      <div className="career-company-wants-card-menu">
        <CompanyWantsMenu
          trigger={<span className="sr-only">Действия: {company.name}</span>}
          triggerClassName="career-company-wants-card-hit"
          items={rowMenuItems(view, company)}
        />
      </div>
    </div>
  );
}
