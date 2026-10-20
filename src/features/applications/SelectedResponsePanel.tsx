import { useCallback, useState } from 'react';
import {
  Buildings,
  CalendarBlank,
  EnvelopeSimple,
  FileText,
  LinkSimple,
  Sparkle,
} from '@phosphor-icons/react';
import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { StarStoriesModal } from '../interview/StarStoriesModal';
import { humanSourceLabel } from './sourceLabels';
import { waitingLabel } from './waitingLabel';
import { FollowUpSentControl } from './ResponsesCardStageControls';
import { ResponseContactRow } from './ResponseContactRow';
import { getApplicationContact, saveApplicationContact } from './applicationContactApi';
import './selected-response-panel.css';

interface SelectedResponsePanelProps {
  readonly application: ApplicationView;
  readonly onMarkFollowUpSent: () => Promise<void>;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}

interface SelectedResponseView {
  readonly displayCompany: string;
  readonly company?: string;
  readonly title: string;
  readonly preparationOpen: boolean;
  readonly storiesOpen: boolean;
  readonly askConsultant?: () => void;
  readonly onStartPreparation: () => void;
  readonly onOpenStories: () => void;
  readonly onClosePreparation: () => void;
  readonly onCloseStories: () => void;
  readonly onOpenStoriesFromPreparation: () => void;
}

export function SelectedResponsePanel(props: SelectedResponsePanelProps) {
  const view = useSelectedResponseView(props.application, props.onOpenExpert);
  return <SelectedResponseContent props={props} view={view} />;
}

function useSelectedResponseView(
  application: ApplicationView,
  onOpenExpert?: SelectedResponsePanelProps['onOpenExpert'],
): SelectedResponseView {
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const displayCompany = application.vacancy?.companyHidden
    ? 'Компания скрыта'
    : application.vacancy?.company || 'Компания не указана';
  const company = application.vacancy?.companyHidden
    ? undefined
    : (application.vacancy?.company ?? undefined);
  const title = application.vacancy?.title ?? 'Вакансия без названия';
  const askConsultant = createResponseExpertHandler(
    application,
    title,
    displayCompany,
    onOpenExpert,
  );
  return {
    displayCompany,
    company,
    title,
    preparationOpen,
    storiesOpen,
    askConsultant,
    onStartPreparation: () => setPreparationOpen(true),
    onOpenStories: () => setStoriesOpen(true),
    onClosePreparation: () => setPreparationOpen(false),
    onCloseStories: () => setStoriesOpen(false),
    onOpenStoriesFromPreparation: () => {
      setPreparationOpen(false);
      setStoriesOpen(true);
    },
  };
}

function SelectedResponseContent({
  props,
  view,
}: {
  readonly props: SelectedResponsePanelProps;
  readonly view: SelectedResponseView;
}) {
  return (
    <section
      className="career-responses-selected"
      aria-labelledby="career-responses-selected-title"
    >
      <SelectedResponseHeader
        application={props.application}
        company={view.displayCompany}
        title={view.title}
      />
      <SelectedResponseDetails
        application={props.application}
        company={view.displayCompany}
        onMarkFollowUpSent={props.onMarkFollowUpSent}
        onStartPreparation={view.onStartPreparation}
        onOpenStories={view.onOpenStories}
        onDiscuss={view.askConsultant}
        hasExpert={Boolean(props.onOpenExpert)}
      />
      <SelectedResponseDialogs
        application={props.application}
        title={view.title}
        company={view.company}
        preparationOpen={view.preparationOpen}
        storiesOpen={view.storiesOpen}
        onClosePreparation={view.onClosePreparation}
        onCloseStories={view.onCloseStories}
        onAskConsultant={props.onOpenExpert ? view.askConsultant : undefined}
        onOpenStories={view.onOpenStoriesFromPreparation}
      />
    </section>
  );
}

function SelectedResponseHeader({
  application,
  company,
  title,
}: {
  readonly application: ApplicationView;
  readonly company: string;
  readonly title: string;
}) {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  return (
    <header className="career-responses-selected__head">
      <div>
        <p className="career-responses-selected__eyebrow">Выбранный отклик</p>
        <h2 id="career-responses-selected-title">
          {company}, {title}
        </h2>
      </div>
      {scheduledAt ? (
        <p className="career-responses-selected__interview">
          <CalendarBlank aria-hidden="true" /> Интервью {formatDateTime(scheduledAt)}
        </p>
      ) : null}
    </header>
  );
}

function SelectedResponseDetails({
  application,
  company,
  onMarkFollowUpSent,
  onStartPreparation,
  onOpenStories,
  onDiscuss,
  hasExpert,
}: {
  readonly application: ApplicationView;
  readonly company: string;
  readonly onMarkFollowUpSent: () => Promise<void>;
  readonly onStartPreparation: () => void;
  readonly onOpenStories: () => void;
  readonly onDiscuss?: () => void;
  readonly hasExpert: boolean;
}) {
  return (
    <>
      <NextStep application={application} />
      <FollowUpSentControl application={application} onMark={onMarkFollowUpSent} />
      <div className="career-responses-selected__columns">
        <Materials application={application} />
        <Delivery application={application} />
      </div>
      <Dossier application={application} company={company} />
      <SelectedResponseActions
        onStartPreparation={onStartPreparation}
        onOpenStories={onOpenStories}
        onDiscuss={onDiscuss}
        hasExpert={hasExpert}
      />
    </>
  );
}

function SelectedResponseActions({
  onStartPreparation,
  onOpenStories,
  onDiscuss,
  hasExpert,
}: {
  readonly onStartPreparation: () => void;
  readonly onOpenStories: () => void;
  readonly onDiscuss?: () => void;
  readonly hasExpert: boolean;
}) {
  return (
    <div className="career-responses-selected__actions">
      <button
        type="button"
        className="career-btn career-btn-primary career-btn-sm"
        onClick={onStartPreparation}
      >
        <Sparkle aria-hidden="true" /> Начать мок-интервью
      </button>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        onClick={onOpenStories}
      >
        Открыть STAR-истории
      </button>
      {hasExpert ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={onDiscuss}
        >
          Обсудить
        </button>
      ) : null}
    </div>
  );
}

function SelectedResponseDialogs({
  application,
  title,
  company,
  preparationOpen,
  storiesOpen,
  onClosePreparation,
  onCloseStories,
  onAskConsultant,
  onOpenStories,
}: {
  readonly application: ApplicationView;
  readonly title: string;
  readonly company?: string;
  readonly preparationOpen: boolean;
  readonly storiesOpen: boolean;
  readonly onClosePreparation: () => void;
  readonly onCloseStories: () => void;
  readonly onAskConsultant?: () => void;
  readonly onOpenStories: () => void;
}) {
  return (
    <>
      <InterviewPrepModal
        isOpen={preparationOpen}
        onClose={onClosePreparation}
        vacancy={{ id: application.id, title, company }}
        onAskConsultant={onAskConsultant}
        onOpenStarStories={onOpenStories}
      />
      <StarStoriesModal
        isOpen={storiesOpen}
        onClose={onCloseStories}
        onAskConsultant={onAskConsultant}
      />
    </>
  );
}

function createResponseExpertHandler(
  application: ApplicationView,
  title: string,
  company: string,
  onOpenExpert?: (stage: CoachTurnStage, subject?: CoachTurnSubject, subjectTitle?: string) => void,
): (() => void) | undefined {
  if (!onOpenExpert) return undefined;
  const stage: CoachTurnStage = application.stage === 'interview' ? 'interviews' : 'responses';
  return () =>
    onOpenExpert(
      stage,
      { kind: 'application', id: application.id },
      `О вакансии: ${title} — ${company}`,
    );
}

function NextStep({ application }: { readonly application: ApplicationView }) {
  const waiting = waitingLabel({
    stage: application.stage,
    whoseTurn: application.whoseTurn,
    hasMaterials: application.materials.coverLetter || application.materials.resume,
    followUp: application.followUp,
    nearestInterviewNeedsPrep:
      application.nearestInterview !== null && application.nearestInterview.prepStatus !== 'ready',
    closedReason: application.closedReason,
  });
  const text = application.nearestInterview?.scheduledAt
    ? `Подготовиться к интервью ${formatDateTime(application.nearestInterview.scheduledAt)}`
    : application.followUp?.dueAt
      ? `${waiting.text} · срок ${formatDateTime(application.followUp.dueAt)}`
      : waiting.text;
  return (
    <div className="career-responses-selected__next" role="status">
      <span>Следующий шаг</span>
      <strong>{text}</strong>
    </div>
  );
}

function Materials({ application }: { readonly application: ApplicationView }) {
  return (
    <section aria-labelledby="career-responses-materials-title">
      <h3 id="career-responses-materials-title">Материалы</h3>
      <ul>
        <li>
          <FileText aria-hidden="true" />
          <span>Резюме</span>
          <strong>
            {application.materials.resume ? 'Подготовлено' : 'Не привязано к отклику'}
          </strong>
        </li>
        <li>
          <EnvelopeSimple aria-hidden="true" />
          <span>Сопроводительное письмо</span>
          <strong>
            {application.materials.coverLetter ? 'Подготовлено' : 'Не привязано к отклику'}
          </strong>
        </li>
      </ul>
    </section>
  );
}

function Delivery({ application }: { readonly application: ApplicationView }) {
  const receipt = application.deliveryReceipt ?? null;
  const state = deliveryState(application.stage, receipt);
  const label =
    state === 'delivered'
      ? 'Доставка подтверждена'
      : state === 'failed'
        ? 'Попытка не удалась'
        : state === 'attempted'
          ? 'Отправка не подтверждена'
          : 'Черновик, не отправлено';
  const receiptUrl = receipt?.kind === 'confirmation_url' ? safeHttpsUrl(receipt.value) : null;
  return (
    <section aria-labelledby="career-responses-delivery-title">
      <h3 id="career-responses-delivery-title">Доставка</h3>
      <p className={`career-responses-selected__delivery is-${state}`}>
        <span>{label}</span>
        {receiptUrl ? (
          <a href={receiptUrl} target="_blank" rel="noreferrer">
            <LinkSimple aria-hidden="true" /> Квитанция
          </a>
        ) : receipt?.kind === 'failure_note' ? (
          <span>{receipt.value}</span>
        ) : receipt ? (
          <span>Квитанция сохранена</span>
        ) : null}
      </p>
    </section>
  );
}

function Dossier({
  application,
  company,
}: {
  readonly application: ApplicationView;
  readonly company: string;
}) {
  const source = application.vacancy?.source;
  return (
    <section
      className="career-responses-selected__dossier"
      aria-labelledby="career-responses-dossier-title"
    >
      <h3 id="career-responses-dossier-title">О компании</h3>
      <p>
        <Buildings aria-hidden="true" />
        <strong>{company}</strong>
        <span>Локация не указана в отклике</span>
      </p>
      <p>
        Роль: {application.vacancy?.title ?? 'не указана'} · источник:{' '}
        {source ? humanSourceLabel(source) : 'не указан'}
      </p>
      <ApplicationContactRow applicationId={application.id} />
      <small>Показаны сведения из отклика; проверенная карточка компании не привязана.</small>
    </section>
  );
}

function ApplicationContactRow({ applicationId }: { readonly applicationId: string }) {
  const load = useCallback(() => getApplicationContact(applicationId), [applicationId]);
  const save = useCallback(
    (name: string | null) => saveApplicationContact(applicationId, name),
    [applicationId],
  );
  return <ResponseContactRow key={applicationId} load={load} save={save} />;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'дата не указана'
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
