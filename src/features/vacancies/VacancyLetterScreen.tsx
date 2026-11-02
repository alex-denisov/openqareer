import { useEffect, useRef, useState } from 'react';
import type { LetterScreenState } from './vacancyLetterController';
import { useVacancyLetterController } from './vacancyLetterController';
import { ArrowLeft, ArrowSquareOut, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ConnectionContactsDialog } from '../outreach/ConnectionContactsDialog';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { usePageTitleOverride } from '../shell/pageTitleOverride';
import { useCandidateDisplayName } from '../shell/candidateDisplayName';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import { CircleTabs } from './VacancyLetterCircles';
import { LetterCardHeading, LetterDestination } from './VacancyLetterDestination';
import { LetterActions } from './VacancyLetterActions';
import {
  LetterEditor,
  LetterNotices,
  LetterSettings,
  PitchBodyState,
  WorkplaceList,
} from './VacancyLetterEditor';
import { LetterInfoTip } from './VacancyLetterInfoTip';
import { TariffQuotaNote } from '../tariffs/TariffQuotaNote';
import './vacancy-letter.css';

export interface VacancyLetterTarget {
  readonly id: string;
  readonly canonicalTitle: string;
  readonly canonicalCompany: string;
  readonly canonicalLocation?: string | null;
  readonly isRemote?: boolean | null;
  readonly sources: readonly { readonly sourceName?: string }[];
  readonly descriptionSummary: string;
  readonly primaryUrl: string;
}

type OpenExpert = (
  stage: CoachTurnStage,
  subject?: CoachTurnSubject,
  subjectTitle?: string,
) => void;

const CIRCLES_TIP =
  'Данные о связях берутся из импортированных контактов. Шанс ответа не показываем: откликов пока мало.';

interface VacancyLetterScreenProps {
  readonly vacancy: VacancyLetterTarget;
  readonly initialCircle?: ConnectionCircleNumber;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
  readonly onOpenExpert?: OpenExpert;
}

function ConnectionsLoading() {
  return (
    <p className="career-letter-loading" role="status" aria-busy="true">
      <CircleNotch size={16} className="career-spin" aria-hidden="true" />
      Загружаем круги связей…
    </p>
  );
}

function ConnectionsError({
  error,
  onRetry,
}: {
  readonly error: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="career-letter-error" role="alert">
      <WarningCircle size={16} aria-hidden="true" />
      <p>{error || 'Не удалось загрузить пути к контактам.'}</p>
      <button type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function VacancyLetterScreen({
  vacancy,
  initialCircle,
  onBack,
  onOpenResponses,
  onOpenResume,
  onOpenExpert,
}: VacancyLetterScreenProps) {
  const state = useVacancyLetterController(vacancy.id, initialCircle);
  return (
    <VacancyLetterPage
      vacancy={vacancy}
      state={state}
      onBack={onBack}
      onOpenResponses={onOpenResponses}
      onOpenResume={onOpenResume}
      onOpenExpert={onOpenExpert}
    />
  );
}

function selectLetterCircle(state: LetterScreenState, circle: ConnectionCircleNumber) {
  state.approval.reset();
  state.circle.setCircle(circle);
  state.circle.setSelectedPathId(null);
}

function useLetterPageActions(vacancy: VacancyLetterTarget, onOpenExpert?: OpenExpert) {
  const [contactsOpen, setContactsOpen] = useState(false);
  const openExpertFor = (stage: CoachTurnStage, title: string) =>
    onOpenExpert?.(stage, { kind: 'vacancy', id: vacancy.id }, title);
  return {
    contactsOpen,
    openContacts: () => setContactsOpen(true),
    closeContacts: () => setContactsOpen(false),
    onGatherFacts: onOpenExpert
      ? () => openExpertFor('profile', 'Факты для письма: ' + vacancy.canonicalTitle)
      : undefined,
    onAskEdits: onOpenExpert
      ? () => openExpertFor('vacancies', 'Правки письма: ' + vacancy.canonicalTitle)
      : undefined,
  };
}

interface VacancyLetterPageProps {
  readonly vacancy: VacancyLetterTarget;
  readonly state: LetterScreenState;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
  readonly onOpenExpert?: OpenExpert;
}

function VacancyLetterPage(props: VacancyLetterPageProps) {
  const { vacancy, state, onBack, onOpenResponses, onOpenResume, onOpenExpert } = props;
  usePageTitleOverride('Письмо');
  const actions = useLetterPageActions(vacancy, onOpenExpert);
  const frozen = Boolean(state.approval.saved);
  return (
    <section className="career-letter-screen" aria-labelledby="career-letter-title">
      <VacancyCard vacancy={vacancy} onBack={onBack} />
      <section className="career-letter-fork" aria-labelledby="career-letter-fork-title">
        <div className="career-letter-sub-head">
          <h2 id="career-letter-fork-title">Как откликнуться: три круга связей</h2>
          <LetterInfoTip text={CIRCLES_TIP} />
        </div>
        <CircleTabs
          selected={state.circle.circle}
          circles={state.circles.data?.circles ?? []}
          frozen={frozen}
          onSelect={(circle) => selectLetterCircle(state, circle)}
        />
      </section>
      <LetterCard
        state={state}
        frozen={frozen}
        actions={actions}
        onOpenResponses={onOpenResponses}
        onOpenResume={onOpenResume}
      />
      {actions.contactsOpen ? (
        <ConnectionContactsDialog
          vacancyCompany={vacancy.canonicalCompany}
          onClose={actions.closeContacts}
          onChanged={state.circles.retry}
        />
      ) : null}
    </section>
  );
}

function LetterDestinationSlot({
  state,
  frozen,
  actions,
  onOpenResume,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly actions: ReturnType<typeof useLetterPageActions>;
  readonly onOpenResume?: () => void;
}) {
  if (state.circles.loading) return <ConnectionsLoading />;
  if (state.circles.error)
    return <ConnectionsError error={state.circles.error} onRetry={state.circles.retry} />;
  return (
    <LetterDestination
      circle={state.circle.circle}
      result={state.circle.result}
      path={state.circle.selectedPath}
      frozen={frozen}
      onSelectPath={(pathId) => {
        state.approval.reset();
        state.circle.setSelectedPathId(pathId);
      }}
      onShowPaths={() => {
        state.approval.reset();
        state.circle.setCircle(2);
        state.circle.setSelectedPathId(null);
      }}
      onOpenContacts={actions.openContacts}
      onOpenResume={onOpenResume}
    />
  );
}

function LetterSettingsSlot({
  state,
  frozen,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
}) {
  return (
    <LetterSettings
      language={state.language}
      tone={state.tone}
      frozen={frozen || state.draft.loading}
      onLanguage={(value) => {
        state.approval.reset();
        state.setLanguage(value);
      }}
      onTone={(value) => {
        state.approval.reset();
        state.setTone(value);
      }}
    />
  );
}

function LetterCard({
  state,
  frozen,
  actions,
  onOpenResponses,
  onOpenResume,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly actions: ReturnType<typeof useLetterPageActions>;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
}) {
  const { circle } = state.circle;
  const pitchReady =
    Boolean(state.draft.pitch && state.draft.text.trim()) &&
    !state.draft.loading &&
    !state.circles.loading &&
    !state.circles.error;
  return (
    <section
      className="career-letter-card"
      id="career-letter-active-circle"
      role="tabpanel"
      aria-labelledby={`career-letter-tab-${circle}`}
    >
      <LetterCardHeading circle={circle} approved={frozen} />
      <LetterDestinationSlot
        state={state}
        frozen={frozen}
        actions={actions}
        onOpenResume={onOpenResume}
      />
      <LetterSettingsSlot state={state} frozen={frozen} />
      <PitchBodyState draft={state.draft} />
      <LetterDraftContent state={state} frozen={frozen} onGatherFacts={actions.onGatherFacts} />
      <LetterActions
        approval={state.approval}
        pitchReady={pitchReady}
        onAskEdits={actions.onAskEdits}
        onOpenResponses={onOpenResponses}
      />
    </section>
  );
}

function LetterDraftContent({
  state,
  frozen,
  onGatherFacts,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly onGatherFacts?: () => void;
}) {
  const senderName = useCandidateDisplayName();
  if (!state.draft.pitch && !state.draft.error) return null;
  const editorFrozen = frozen || state.draft.loading;
  return (
    <>
      <LetterEditor
        draft={state.draft}
        circle={state.circle.circle}
        senderName={senderName}
        frozen={editorFrozen}
        onEdit={state.approval.reset}
      />
      {state.draft.pitch ? (
        <LetterNotices
          pitch={state.draft.pitch}
          language={state.language}
          onGatherFacts={onGatherFacts}
        />
      ) : null}
      <TariffQuotaNote quota="applications" refreshKey={state.draft.loading} />
      {state.draft.pitch ? (
        <WorkplaceList
          workplaces={state.draft.workplaces}
          includedIds={state.draft.includedIds}
          frozen={editorFrozen}
          onToggle={(id) => {
            state.approval.reset();
            state.draft.toggle(id);
          }}
        />
      ) : null}
    </>
  );
}

function LetterBackButton({ onBack }: { readonly onBack: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      className="career-btn is-icon is-ghost career-letter-back"
      onClick={onBack}
      aria-label="Назад к вакансиям"
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </button>
  );
}

function VacancyCard({
  vacancy,
  onBack,
}: {
  readonly vacancy: VacancyLetterTarget;
  readonly onBack: () => void;
}) {
  const location = vacancy.canonicalLocation ?? 'Локация не указана';
  const sources = vacancy.sources.map((source) => source.sourceName).filter(Boolean);
  return (
    <section className="career-letter-vacancy" aria-label="Вакансия">
      <LetterBackButton onBack={onBack} />
      <div className="career-letter-vacancy-copy">
        <h2 id="career-letter-title">{vacancy.canonicalTitle}</h2>
        <p>
          {vacancy.canonicalCompany} · {location} ·{' '}
          {vacancy.isRemote === true ? 'Удалённо' : 'Формат не указан'}
          {sources.length ? ' · ' + sources.join(', ') : ''}
        </p>
        <details className="career-letter-description">
          <summary>Показать описание</summary>
          <p>{vacancy.descriptionSummary.trim() || 'Описание вакансии не указано.'}</p>
        </details>
      </div>
      {vacancy.primaryUrl ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => void openExternalLink(vacancy.primaryUrl)}
        >
          <ArrowSquareOut size={16} aria-hidden="true" />
          Открыть вакансию
        </button>
      ) : (
        <p className="career-letter-muted">Ссылка на вакансию не указана.</p>
      )}
    </section>
  );
}
