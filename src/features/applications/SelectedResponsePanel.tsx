import { useCallback, useState, type ReactNode } from 'react';
import {
  Buildings,
  ChatCircle,
  ChatText,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  FileText,
  LinkSimple,
  ListChecks,
  Microphone,
  Path,
  Target,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { deliveryState } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { mockInterviewVacancyFromApplication } from '../interview/mockInterviewVacancy';
import { StarStoriesModal } from '../interview/StarStoriesModal';
import { humanSourceLabel } from './sourceLabels';
import { ResponseStatusMenu, type ResponseStatusMenuProps } from './ResponsesCard';
import { formatDayMonth, responseNextStep } from './responseCardFace';
import { FollowUpSentControl } from './ResponsesCardStageControls';
import { ResponseContactRow } from './ResponseContactRow';
import { getApplicationContact, saveApplicationContact } from './applicationContactApi';
import { daysLeft, NextStepRow, responseSubline, stepDeadline } from './SelectedResponseMobile';
import './selected-response-panel.css';

type SelectedResponsePanelProps = Omit<ResponseStatusMenuProps, 'application'> & {
  readonly application: ApplicationView;
  readonly onMarkFollowUpSent: () => Promise<void>;
};

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
        props={props}
        company={view.displayCompany}
        title={view.title}
        onDiscuss={view.askConsultant}
      />
      <SelectedResponseDetails
        application={props.application}
        company={view.displayCompany}
        onMarkFollowUpSent={props.onMarkFollowUpSent}
        onStartPreparation={view.onStartPreparation}
        onOpenStories={view.onOpenStories}
        onDiscuss={view.askConsultant}
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
  props,
  company,
  title,
  onDiscuss,
}: {
  readonly props: SelectedResponsePanelProps;
  readonly company: string;
  readonly title: string;
  readonly onDiscuss?: () => void;
}) {
  return (
    <header className="career-responses-selected__head">
      <div className="career-responses-selected__title">
        {/* 390 (mockup 5 `proc`) shows the company alone; the role moves to the subline. */}
        <h2 id="career-responses-selected-title" className="career-section-title">
          {company}
          <span className="career-responses-selected__title-role">, {title}</span>
        </h2>
        <p className="career-responses-selected__sub">{responseSubline(props.application)}</p>
      </div>
      <div className="career-responses-selected__head-actions">
        <ResponseStatusMenu {...props} />
        {onDiscuss ? (
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-sm career-responses-selected__discuss"
            onClick={onDiscuss}
          >
            <ChatCircle aria-hidden="true" /> Обсудить
          </button>
        ) : null}
      </div>
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
}: {
  readonly application: ApplicationView;
  readonly company: string;
  readonly onMarkFollowUpSent: () => Promise<void>;
  readonly onStartPreparation: () => void;
  readonly onOpenStories: () => void;
  readonly onDiscuss?: () => void;
}) {
  // An interview step opens its preparation; any other step is worked out with the consultant.
  const openStep = application.stage === 'interview' ? onStartPreparation : onDiscuss;
  return (
    <>
      <NextStep application={application} />
      <NextStepRow application={application} onOpen={openStep} />
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
      />
    </>
  );
}

/** At 390 the row is pinned above the menu: «Начать мок-интервью» plus the round chat button. */
function SelectedResponseActions({
  onStartPreparation,
  onOpenStories,
  onDiscuss,
}: {
  readonly onStartPreparation: () => void;
  readonly onOpenStories: () => void;
  readonly onDiscuss?: () => void;
}) {
  return (
    <div className="career-responses-selected__actions">
      <button
        type="button"
        className="career-btn career-btn-primary career-btn-sm"
        onClick={onStartPreparation}
      >
        <Microphone aria-hidden="true" /> Начать мок-интервью
      </button>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-responses-selected__stories"
        onClick={onOpenStories}
      >
        <ListChecks aria-hidden="true" /> Открыть STAR-истории
      </button>
      {onDiscuss ? (
        <button
          type="button"
          className="career-responses-selected__chat"
          aria-label="Обсудить с консультантом"
          onClick={onDiscuss}
        >
          <ChatText aria-hidden="true" />
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
        startInMockInterview
        vacancy={{ ...mockInterviewVacancyFromApplication(application), title, company }}
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
  const next = responseNextStep(application);
  const left = daysLeft(stepDeadline(application));
  return (
    <p className="career-responses-selected__next" role="status">
      <Target aria-hidden="true" />
      <span>
        Следующий шаг: {lowerFirst(next.text)}.{left === null ? '' : ` ${left}.`}
      </span>
    </p>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase('ru-RU') + text.slice(1);
}

interface PanelRowProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly aside?: ReactNode;
}

function PanelRow({ icon, title, detail, aside }: PanelRowProps) {
  return (
    <div className="career-responses-selected__row">
      <span className="career-responses-selected__row-icon">{icon}</span>
      <span className="career-responses-selected__row-text">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {aside ? <span className="career-responses-selected__row-aside">{aside}</span> : null}
    </div>
  );
}

/** Mockup 5 «Материалы». Material bodies are not linked to the record yet, so no «Открыть». */
function Materials({ application }: { readonly application: ApplicationView }) {
  const { resume, coverLetter } = application.materials;
  return (
    <section aria-labelledby="career-responses-materials-title">
      <h3 id="career-responses-materials-title" className="career-subsection-title">
        Материалы
      </h3>
      <div className="career-responses-selected__rows">
        <PanelRow
          icon={<FileText aria-hidden="true" />}
          title={resume ? 'Резюме под вакансию' : 'Резюме не привязано'}
          detail={
            resume
              ? 'Версия сохранена вместе с откликом'
              : 'Отклик ушёл без сохранённой версии резюме'
          }
        />
        <PanelRow
          icon={<EnvelopeSimple aria-hidden="true" />}
          title={coverLetter ? 'Письмо' : 'Письмо не привязано'}
          detail={
            coverLetter ? 'Текст сохранён вместе с откликом' : 'Отклик ушёл без сохранённого письма'
          }
        />
        <PanelRow
          icon={<Path aria-hidden="true" />}
          title="Трек рекомендации"
          detail="Путь через связи для этого отклика не построен"
        />
      </div>
    </section>
  );
}

/** Mockup 5 «Доставка»: one row per recorded attempt with its receipt. */
function Delivery({ application }: { readonly application: ApplicationView }) {
  const receipt = application.deliveryReceipt ?? null;
  const state = deliveryState(application.stage, receipt);
  const channel = application.vacancy?.source
    ? humanSourceLabel(application.vacancy.source)
    : 'Канал не указан';
  const sentAt = formatDayMonth(application.appliedAt);
  const receiptUrl = receipt?.kind === 'confirmation_url' ? safeHttpsUrl(receipt.value) : null;
  const detail =
    state === 'prepared'
      ? 'Черновик, ничего не отправлено'
      : state === 'failed'
        ? `Ошибка: ${receipt?.value ?? 'причина не указана'}. Ничего не отправлено.`
        : [
            sentAt ? `Отправлено ${sentAt}` : 'Дата отправки не указана',
            receipt ? 'квитанция сохранена' : 'квитанции нет',
          ].join(' · ');
  return (
    <section aria-labelledby="career-responses-delivery-title">
      <h3 id="career-responses-delivery-title" className="career-subsection-title">
        Доставка
      </h3>
      <div className="career-responses-selected__rows">
        <PanelRow
          icon={<DeliveryIcon state={state} />}
          title={channel}
          detail={detail}
          aside={
            receiptUrl ? (
              <a href={receiptUrl} target="_blank" rel="noreferrer">
                <LinkSimple aria-hidden="true" /> Квитанция
              </a>
            ) : (
              <span className={`career-responses-status-pill is-${DELIVERY_TONE[state]}`}>
                {DELIVERY_LABEL[state]}
              </span>
            )
          }
        />
      </div>
    </section>
  );
}

const DELIVERY_LABEL = {
  prepared: 'Черновик',
  attempted: 'Не подтверждено',
  delivered: 'Доставлено',
  failed: 'Не доставлено',
} as const;

const DELIVERY_TONE = {
  prepared: 'draft',
  attempted: 'sent',
  delivered: 'ok',
  failed: 'fail',
} as const;

function DeliveryIcon({ state }: { readonly state: keyof typeof DELIVERY_LABEL }) {
  if (state === 'delivered') return <CheckCircle aria-hidden="true" />;
  if (state === 'failed') return <WarningCircle aria-hidden="true" />;
  return <Clock aria-hidden="true" />;
}

/** Mockup 5 company section of the selected response. Interviewers are not in the model yet: an honest empty row. */
function Dossier({
  application,
  company,
}: {
  readonly application: ApplicationView;
  readonly company: string;
}) {
  const source = application.vacancy?.source ? humanSourceLabel(application.vacancy.source) : null;
  const since = formatDayMonth(application.createdAt);
  return (
    <section
      className="career-responses-selected__dossier"
      aria-labelledby="career-responses-dossier-title"
    >
      <h3 id="career-responses-dossier-title" className="career-subsection-title">
        О компании
      </h3>
      <div className="career-responses-selected__rows is-plain">
        <PanelRow
          icon={<Buildings aria-hidden="true" />}
          title={`Компания: ${company}`}
          detail={`Роль: ${application.vacancy?.title ?? 'не указана'}. Проверенная карточка компании не привязана.`}
          aside={
            source ? (
              <small>
                <LinkSimple aria-hidden="true" /> {source}
                {since ? `, ${since}` : ''}
              </small>
            ) : null
          }
        />
        <PanelRow
          icon={<UsersThree aria-hidden="true" />}
          title="Интервьюеры не указаны"
          detail="Имена появятся, когда компания пришлёт приглашение"
        />
        <ApplicationContactRow applicationId={application.id} />
      </div>
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

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
