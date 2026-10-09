import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CircleNotch,
  EnvelopeSimple,
  Info,
  Target,
  UsersThree,
} from '@phosphor-icons/react';
import type {
  CandidateCompanyDetails,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import { SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import { RecruiterMessagePanel } from './RecruiterMessagePanel';
import {
  companyVacancySummary,
  formatObservedDate,
  readableError,
} from './companiesAndPeopleUtils';

function ContactImportNotice({
  company,
  linkedinStatus,
  onOpenConnections,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly linkedinStatus: CandidateCompanyPage['linkedin'];
  readonly onOpenConnections?: () => void;
}) {
  if (company.contactsCount !== null) {
    return (
      <p className="companies-people-data-note" role="note">
        <UsersThree aria-hidden="true" /> Контакты в сети: {company.contactsCount}. Импорт LinkedIn,{' '}
        {formatObservedDate(company.contactsImportedAt)}.
      </p>
    );
  }
  const message =
    linkedinStatus.status === 'disconnected'
      ? 'Контакты в вашей сети неизвестны: LinkedIn не подключён.'
      : 'Контакты в вашей сети неизвестны: список связей LinkedIn не импортирован.';
  return (
    <div className="companies-people-data-note" role="note">
      <Info aria-hidden="true" />
      <span>{message}</span>
      {linkedinStatus.status === 'disconnected' && onOpenConnections ? (
        <button type="button" className="career-btn" onClick={onOpenConnections}>
          Подключить LinkedIn
        </button>
      ) : null}
    </div>
  );
}

function CompanyVacancyList({
  company,
  detail,
  loading,
  loadingMore,
  onLoadMore,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly detail: CandidateCompanyDetails | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}) {
  if (loading)
    return (
      <p className="companies-people-status" role="status">
        Загружаем вакансии компании…
      </p>
    );
  const vacancies = detail?.company.key === company.key ? detail.vacancies : company.vacancies;
  if (vacancies.length === 0)
    return <p className="companies-people-empty">В текущей подборке нет вакансий этой компании.</p>;
  return (
    <div className="companies-people-vacancy-list">
      {vacancies.map((vacancy) => (
        <CompanyVacancyCard key={vacancy.id} vacancy={vacancy} />
      ))}
      {detail?.nextOffset !== null && detail?.nextOffset !== undefined ? (
        <button
          type="button"
          className="companies-people-load-more"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? 'Загружаем…' : 'Показать ещё вакансии'}
        </button>
      ) : null}
    </div>
  );
}

function CompanyVacancyCard({
  vacancy,
}: {
  readonly vacancy: CandidateCompanyDetails['vacancies'][number];
}) {
  const content = (
    <>
      <strong>{vacancy.title}</strong>
      <span>
        {vacancy.location ?? 'Место неизвестно'} · {vacancy.sourceName},{' '}
        {formatObservedDate(vacancy.sourceDate)}
      </span>
    </>
  );
  return vacancy.href ? (
    <a className="companies-people-vacancy" href={vacancy.href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="companies-people-vacancy">{content}</div>
  );
}

async function submitNextStep({
  event,
  text,
  dueAt,
  onSave,
  onCancel,
  onError,
}: {
  readonly event: FormEvent;
  readonly text: string;
  readonly dueAt: string;
  readonly onSave: (text: string, dueAt: string | null) => Promise<void>;
  readonly onCancel: () => void;
  readonly onError: (message: string | null) => void;
}) {
  event.preventDefault();
  if (!text.trim()) {
    onError('Укажите следующий шаг.');
    return;
  }
  try {
    await onSave(text.trim(), dueAt || null);
    onError(null);
    onCancel();
  } catch (reason) {
    onError(readableError(reason, 'Не удалось сохранить следующий шаг.'));
  }
}

function NextStepEditor({
  company,
  busy,
  onCancel,
  onSave,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (text: string, dueAt: string | null) => Promise<void>;
}) {
  const [text, setText] = useState(company.nextStep?.text ?? '');
  const [dueAt, setDueAt] = useState(company.nextStep?.dueAt ?? '');
  const [error, setError] = useState<string | null>(null);
  const handleSubmit = (event: FormEvent) =>
    submitNextStep({ event, text, dueAt, onSave, onCancel, onError: setError });
  return (
    <form className="companies-people-next-step-editor" onSubmit={handleSubmit}>
      <label>
        Следующий шаг
        <input value={text} maxLength={180} onChange={(event) => setText(event.target.value)} />
      </label>
      <label>
        Дата
        <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      </label>
      {error ? (
        <p className="companies-people-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="companies-people-actions">
        <button type="submit" className="companies-people-action is-primary" disabled={busy}>
          Сохранить шаг
        </button>
        <button type="button" className="companies-people-action" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

interface CompanyRecruitersProps {
  readonly company: CandidateCompanyOpportunity;
  readonly consentGranted: boolean;
  readonly consentRequired: boolean;
  readonly editingStep: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSearch: () => void;
  readonly onAllowAndSearch: () => void;
  readonly onWrite: (recruiter: CandidateCompanyRecruiter) => void;
}

function CompanyRecruiterCards({
  company,
  editingStep,
  onWrite,
}: Pick<CompanyRecruitersProps, 'company' | 'editingStep' | 'onWrite'>) {
  return (
    <div className="companies-people-recruiter-list">
      {company.recruiters.map((person, index) => (
        <article className="companies-people-recruiter" key={person.id}>
          <strong>{person.fullName}</strong>
          <span>{person.roleTitle}</span>
          <small>
            {person.sourceLabel} · {formatObservedDate(person.sourceDate)}
          </small>
          {person.isHypothesis ? (
            <small>Предположение по должности и компании: проверьте профиль.</small>
          ) : null}
          <button
            type="button"
            className={`companies-people-action${company.want && !editingStep && index === 0 ? ' is-primary' : ''}`}
            onClick={() => onWrite(person)}
          >
            <EnvelopeSimple aria-hidden="true" /> Подготовить сообщение
          </button>
        </article>
      ))}
    </div>
  );
}

function RecruiterSearchProgress() {
  return (
    <p className="companies-people-status" role="status" aria-busy="true">
      <CircleNotch className="career-spin" aria-hidden="true" /> Поиск рекрутёра выполняется по
      вакансиям компании.
    </p>
  );
}

function RecruiterSearchPrompt({
  company,
  props,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly props: CompanyRecruitersProps;
}) {
  if (props.busy || ['queued', 'running'].includes(company.recruiterSearchStatus))
    return <RecruiterSearchProgress />;
  if (company.vacancyCount === 0) {
    return (
      <p className="companies-people-empty">
        Нет вакансий компании в текущей подборке, поэтому искать рекрутёра пока не по чему.
      </p>
    );
  }
  if (props.consentRequired || !props.consentGranted) {
    return (
      <SearchRecruiterAction
        company={company}
        props={props}
        label="Разрешить и найти"
        onClick={props.onAllowAndSearch}
        message={SEARCH_CONSENT_TEXT}
      />
    );
  }
  const noResult = company.recruiterSearchStatus === 'ready';
  return (
    <SearchRecruiterAction
      company={company}
      props={props}
      label={
        noResult || company.recruiterSearchStatus === 'failed'
          ? 'Повторить поиск'
          : 'Найти рекрутера'
      }
      onClick={props.onSearch}
      message={
        props.error ??
        (noResult ? 'Рекрутер не найден в объявлениях вакансий и публичных профилях.' : null)
      }
    />
  );
}

function SearchRecruiterAction({
  company,
  props,
  label,
  message,
  onClick,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly props: CompanyRecruitersProps;
  readonly label: string;
  readonly message?: string | null;
  readonly onClick: () => void;
}) {
  return (
    <div className="companies-people-empty">
      {message ? <p>{message}</p> : null}
      <button
        type="button"
        className={`companies-people-action${company.want && !props.editingStep ? ' is-primary' : ''}`}
        disabled={props.busy}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}

function CompanyRecruiters(props: CompanyRecruitersProps) {
  return (
    <section className="companies-people-section" aria-labelledby="company-people-title">
      <h3 id="company-people-title">Люди</h3>
      {props.company.recruiters.length > 0 ? (
        <CompanyRecruiterCards
          company={props.company}
          editingStep={props.editingStep}
          onWrite={props.onWrite}
        />
      ) : (
        <RecruiterSearchPrompt company={props.company} props={props} />
      )}
    </section>
  );
}

interface CompanyDetailPanelProps {
  readonly company: CandidateCompanyOpportunity;
  readonly detail: CandidateCompanyDetails | null;
  readonly linkedin: CandidateCompanyPage['linkedin'];
  readonly searchConsentGranted: boolean;
  readonly consentRequired: boolean;
  readonly detailLoading: boolean;
  readonly detailLoadingMore: boolean;
  readonly detailError: string | null;
  readonly actionError: string | null;
  readonly busyWant: boolean;
  readonly busySearch: boolean;
  readonly busyNextStep: boolean;
  readonly onBack: () => void;
  readonly onOpenConnections?: () => void;
  readonly onLoadMoreVacancies: () => void;
  readonly onToggleWant: () => void;
  readonly onSaveNextStep: (text: string, dueAt: string | null) => Promise<void>;
  readonly onSearch: () => void;
  readonly onAllowAndSearch: () => void;
}

function CompanyDetailHeader({
  company,
  busyWant,
  onBack,
  onToggleWant,
}: Pick<CompanyDetailPanelProps, 'company' | 'busyWant' | 'onBack' | 'onToggleWant'>) {
  return (
    <>
      <button type="button" className="companies-people-mobile-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> Назад к компаниям
      </button>
      <div className="companies-people-detail-heading">
        <div>
          <h2>{company.name}</h2>
          <p>
            {companyVacancySummary(company)} в текущей подборке
            {company.location ? ` · ${company.location}` : ''}
          </p>
          {company.sources.length > 0 ? (
            <p>
              Источники вакансий:{' '}
              {company.sources
                .map((source) => `${source.name}, ${formatObservedDate(source.observedAt)}`)
                .join(' · ')}
            </p>
          ) : null}
        </div>
        <WantToggle company={company} busy={busyWant} onClick={onToggleWant} />
      </div>
    </>
  );
}

function CompanyVacancySection(props: CompanyDetailPanelProps) {
  return (
    <section className="companies-people-section" aria-labelledby="company-vacancies-title">
      <h3 id="company-vacancies-title">Вакансии · {props.company.vacancyCount}</h3>
      {props.detailError ? (
        <p className="companies-people-error" role="alert">
          {props.detailError}
        </p>
      ) : null}
      <CompanyVacancyList
        company={props.company}
        detail={props.detail}
        loading={props.detailLoading}
        loadingMore={props.detailLoadingMore}
        onLoadMore={props.onLoadMoreVacancies}
      />
    </section>
  );
}

function CompanyDetailContent(props: CompanyDetailPanelProps) {
  const [editingStep, setEditingStep] = useState(false);
  const [messageTo, setMessageTo] = useState<CandidateCompanyRecruiter | null>(null);
  return (
    <>
      {props.actionError ? (
        <p className="companies-people-error" role="alert">
          {props.actionError}
        </p>
      ) : null}
      {props.company.want ? (
        <CompanyNextStep
          company={props.company}
          editing={editingStep}
          busy={props.busyNextStep}
          onEdit={() => setEditingStep(true)}
          onCancel={() => setEditingStep(false)}
          onSave={props.onSaveNextStep}
        />
      ) : null}
      <CompanyVacancySection {...props} />
      <ContactImportNotice
        company={props.company}
        linkedinStatus={props.linkedin}
        onOpenConnections={props.onOpenConnections}
      />
      <CompanyRecruiters
        company={props.company}
        consentGranted={props.searchConsentGranted}
        consentRequired={props.consentRequired}
        editingStep={editingStep}
        busy={props.busySearch}
        error={props.actionError}
        onSearch={props.onSearch}
        onAllowAndSearch={props.onAllowAndSearch}
        onWrite={setMessageTo}
      />
      {messageTo ? (
        <div className="companies-people-message">
          <RecruiterMessagePanel contact={messageTo} onClose={() => setMessageTo(null)} />
        </div>
      ) : null}
    </>
  );
}

export function CompanyDetailPanel(props: CompanyDetailPanelProps) {
  return (
    <article className="companies-people-detail">
      <CompanyDetailHeader
        company={props.company}
        busyWant={props.busyWant}
        onBack={props.onBack}
        onToggleWant={props.onToggleWant}
      />
      <CompanyDetailContent {...props} />
    </article>
  );
}

function WantToggle({
  company,
  busy,
  onClick,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        company.want ? 'companies-people-want-toggle' : 'companies-people-action is-primary'
      }
      aria-pressed={company.want}
      disabled={busy}
      onClick={onClick}
    >
      <Target aria-hidden="true" /> {company.want ? 'Убрать' : 'Хочу в эту компанию'}
    </button>
  );
}

function CompanyNextStep({
  company,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: (text: string, dueAt: string | null) => Promise<void>;
}) {
  if (editing)
    return <NextStepEditor company={company} busy={busy} onCancel={onCancel} onSave={onSave} />;
  return (
    <div className="companies-people-next-step">
      <Info aria-hidden="true" />
      {company.nextStep ? (
        <span>
          Следующий шаг: {company.nextStep.text}
          {company.nextStep.dueAt ? `, до ${formatObservedDate(company.nextStep.dueAt)}` : ''}
        </span>
      ) : (
        <span>Следующий шаг не задан.</span>
      )}
      <button type="button" className="companies-people-action" disabled={busy} onClick={onEdit}>
        {company.nextStep ? 'Изменить шаг' : 'Добавить шаг'}
      </button>
    </div>
  );
}
