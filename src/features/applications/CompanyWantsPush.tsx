import { useEffect, type ReactNode } from 'react';
import { ArrowsClockwise, Briefcase, CaretRight, Path, Trash } from '@phosphor-icons/react';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import { pluralRu } from '../../../shared/pluralRu';
import { CompanyWantsMenu } from './CompanyWantsMenu';
import { WANT_STAGE_LABELS, nextStepText, toSelectionItem } from './companyWantsModel';
import { ResponsesMobilePush } from './ResponsesMobilePush';
import {
  Feedback,
  StageIcon,
  stageMenuItems,
  type CompanyWantsView,
} from './ResponsesCompanyWants';

/**
 * Макет 5 `co` at 390: one company of «Хочу» with the row menu's actions laid out as rows.
 * The mockup's «Оповещения о вакансиях» row has no per-company switch behind it, so it is
 * not drawn (no placeholders).
 */
export function CompanyWantsPush({
  view,
  companyKey,
  onBack,
}: {
  readonly view: CompanyWantsView;
  readonly companyKey: string;
  readonly onBack: () => void;
}) {
  const company = view.controller.items.find((item) => item.key === companyKey);
  // Removed from «Хочу» (or gone from the page after a reload): back to the list.
  useEffect(() => {
    if (!company) onBack();
  }, [company, onBack]);
  if (!company) return null;
  return (
    <ResponsesMobilePush
      view={{ kind: 'company' }}
      onBack={onBack}
      onOpenConsultant={view.openConsultant}
    >
      <div className="career-responses-mobile-push-intro">
        <h3>{company.name}</h3>
        <p>{[company.industry, 'в списке «Хочу»'].filter(Boolean).join(' · ')}</p>
      </div>
      <Feedback controller={view.controller} />
      <CompanyFacts company={company} />
      <CompanyActions view={view} company={company} />
      <OpenVacancies view={view} company={company} />
    </ResponsesMobilePush>
  );
}

function CompanyFacts({ company }: { readonly company: CandidateCompanyOpportunity }) {
  const stage = company.wantStage ?? 'want';
  return (
    <dl className="career-responses-mobile-list" aria-label="О компании">
      <div>
        <dt>Статус</dt>
        <dd className={`career-company-wants-tag is-${stage}`}>
          <StageIcon stage={stage} />
          {WANT_STAGE_LABELS[stage]}
        </dd>
      </div>
      <div>
        <dt>Вакансий</dt>
        <dd className="career-company-wants-num">{company.vacancyCount}</dd>
      </div>
      {company.contactsCount === null ? null : (
        <div>
          <dt>Контактов в сети</dt>
          <dd className="career-company-wants-num">{company.contactsCount}</dd>
        </div>
      )}
      <div>
        <dt>Следующий шаг</dt>
        <dd>{nextStepText(company)}</dd>
      </div>
    </dl>
  );
}

function RowBody({
  icon,
  title,
  sub,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly sub?: string;
}) {
  return (
    <>
      <span className="career-company-wants-add-ico">{icon}</span>
      <span className="career-company-wants-add-main">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <CaretRight className="career-company-wants-chev" aria-hidden="true" />
    </>
  );
}

function pathRow(company: CandidateCompanyOpportunity): { title: string; sub?: string } {
  const title = company.hasRecruiter ? 'Обновить путь к рекрутеру' : 'Найти путь к рекрутеру';
  if (company.recruiterSearchStatus === 'queued' || company.recruiterSearchStatus === 'running') {
    return { title, sub: 'Поиск уже идёт' };
  }
  if (company.vacancyCount === 0) return { title, sub: 'Нужна хотя бы одна вакансия компании' };
  return { title };
}

function CompanyActions({
  view,
  company,
}: {
  readonly view: CompanyWantsView;
  readonly company: CandidateCompanyOpportunity;
}) {
  const { controller } = view;
  const item = [toSelectionItem(company)];
  const path = pathRow(company);
  return (
    <>
      <div className="career-company-wants-group career-company-wants-push-rows">
        <button
          type="button"
          className="career-company-wants-add-row"
          disabled={controller.busy || path.sub !== undefined}
          onClick={() => controller.findPaths(item)}
        >
          <RowBody icon={<Path aria-hidden="true" />} title={path.title} sub={path.sub} />
        </button>
        <CompanyWantsMenu
          trigger={<RowBody icon={<ArrowsClockwise aria-hidden="true" />} title="Сменить статус" />}
          triggerClassName="career-company-wants-add-row"
          disabled={controller.busy}
          items={stageMenuItems(controller, item, view.openNextStep)}
        />
      </div>
      <div className="career-company-wants-group">
        <button
          type="button"
          className="career-company-wants-add-row career-company-wants-remove-row"
          disabled={controller.busy}
          onClick={() => controller.requestRemoval(item)}
        >
          <span className="career-company-wants-add-ico">
            <Trash aria-hidden="true" />
          </span>
          <span className="career-company-wants-add-main">
            <b>Убрать из «Хочу»</b>
          </span>
        </button>
      </div>
    </>
  );
}

function OpenVacancies({
  view,
  company,
}: {
  readonly view: CompanyWantsView;
  readonly company: CandidateCompanyOpportunity;
}) {
  const open = view.openCompanyVacancies;
  if (!open || company.vacancyCount === 0 || company.outsideSelection) return null;
  return (
    <div className="career-prep-cta career-company-wants-push-cta">
      <button
        type="button"
        className="career-btn career-btn-primary"
        onClick={() => open(company.name)}
      >
        <Briefcase aria-hidden="true" /> Открыть{' '}
        {pluralRu(company.vacancyCount, ['вакансию', 'вакансии', 'вакансий'])}
      </button>
    </div>
  );
}
