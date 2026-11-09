import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LetterScreenState } from './vacancyLetterController';
import { useVacancyLetterController } from './vacancyLetterController';
import {
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';
import { vacancySourceDisplayName } from '../../../shared/vacancySourceLabel';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ConnectionContactsDialog } from '../outreach/ConnectionContactsDialog';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { usePageTitleOverride } from '../shell/pageTitleOverride';
import { useCandidateDisplayName } from '../shell/candidateDisplayName';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import { circleSummary, CircleTabs } from './VacancyLetterCircles';
import { LetterCardHeading, LetterDestination } from './VacancyLetterDestination';
import { resumeRowForLetter } from './vacancyLetterResumeNote';
import { LetterActions } from './VacancyLetterActions';
import type { LetterPlatform } from './VacancyLetterPlatformStep';
import type { VacancyApplications } from './useVacancyApplications';
import { LetterEditor, LetterNotices, LetterSettings, PitchBodyState } from './VacancyLetterEditor';
import { LetterInfoTip } from './VacancyLetterInfoTip';
import { TariffQuotaNote } from '../tariffs/TariffQuotaNote';
import { useLetterConsultantSuggestion } from './letterConsultantSuggestion';
import { VacancyLetterMobileBar } from './VacancyLetterMobileBar';
import { useCompactViewport } from './useCompactViewport';
import { useKeyboardInset } from './useLetterViewport';
import './vacancy-letter.css';
import './vacancy-letter-mobile.css';

export interface VacancyLetterTarget {
  readonly id: string;
  readonly canonicalTitle: string;
  readonly canonicalCompany: string;
  readonly canonicalLocation?: string | null;
  readonly isRemote?: boolean | null;
  readonly sources: readonly { readonly sourceName?: string; readonly sourceId?: string }[];
  readonly descriptionSummary: string;
  readonly primaryUrl: string;
}

type OpenExpert = (
  stage: CoachTurnStage,
  subject?: CoachTurnSubject,
  subjectTitle?: string,
  initialPrompt?: string,
  options?: { readonly focusInput?: boolean },
) => void;

/** Д4: with the panel already open the tap changes nothing else, so the cursor is the answer. */
export const askEditsOptions = { focusInput: true } as const;

const CIRCLES_TIP =
  'Данные о связях берутся из импортированных контактов. Шанс ответа не показываем: откликов пока мало.';

interface VacancyLetterScreenProps {
  readonly vacancy: VacancyLetterTarget;
  readonly initialCircle?: ConnectionCircleNumber;
  readonly onBack: () => void;
  readonly applications?: VacancyApplications;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
  readonly onOpenExpert?: OpenExpert;
}

/** B629: the platform step after approval; the mark goes to the same «Отклики» as the row. */
export function letterPlatform(
  vacancy: VacancyLetterTarget,
  applications?: VacancyApplications,
): LetterPlatform {
  return {
    url: vacancy.primaryUrl,
    applied: applications?.byCluster.get(vacancy.id)?.status === 'applied',
    onConfirmSent: applications
      ? () =>
          applications.recordConfirmed(vacancy.id, 'applied', {
            title: vacancy.canonicalTitle,
            company: vacancy.canonicalCompany,
            url: vacancy.primaryUrl,
            source: vacancy.sources[0]?.sourceId ?? '',
          })
      : undefined,
  };
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
  applications,
  onOpenResponses,
  onOpenResume,
  onOpenExpert,
}: VacancyLetterScreenProps) {
  const state = useVacancyLetterController(vacancy.id, initialCircle);
  useLetterConsultantSuggestion(state.draft, Boolean(state.approval.saved));
  return (
    <VacancyLetterPage
      vacancy={vacancy}
      state={state}
      onBack={onBack}
      platform={letterPlatform(vacancy, applications)}
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
      ? () =>
          onOpenExpert(
            'vacancies',
            { kind: 'vacancy', id: vacancy.id },
            'Правки письма: ' + vacancy.canonicalTitle,
            undefined,
            askEditsOptions,
          )
      : undefined,
    onOpenConsultant: onOpenExpert
      ? () => openExpertFor('vacancies', 'Письмо: ' + vacancy.canonicalTitle)
      : undefined,
  };
}

interface VacancyLetterPageProps {
  readonly vacancy: VacancyLetterTarget;
  readonly state: LetterScreenState;
  readonly onBack: () => void;
  readonly platform?: LetterPlatform;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
  readonly onOpenExpert?: OpenExpert;
}

function VacancyLetterPage(props: VacancyLetterPageProps) {
  const { vacancy, state, onBack, onOpenResponses, onOpenResume, onOpenExpert } = props;
  usePageTitleOverride('Письмо');
  const actions = useLetterPageActions(vacancy, onOpenExpert);
  const frozen = Boolean(state.approval.saved);
  // Макет 9 при 390: «Назад» и консультант — в шапке экрана, в карточке вакансии «Назад» нет.
  const compact = useCompactViewport();
  const keyboardInset = useKeyboardInset(compact);
  return (
    <section
      className="career-letter-screen"
      aria-labelledby="career-letter-title"
      style={
        keyboardInset
          ? ({ '--career-letter-keyboard': `${keyboardInset}px` } as CSSProperties)
          : undefined
      }
    >
      {compact ? (
        <VacancyLetterMobileBar onBack={onBack} onOpenConsultant={actions.onOpenConsultant} />
      ) : null}
      <VacancyCard vacancy={vacancy} compact={compact} onBack={compact ? undefined : onBack} />
      <LetterFork state={state} frozen={frozen} />
      <LetterCard
        state={state}
        vacancyUrl={vacancy.primaryUrl}
        frozen={frozen}
        actions={actions}
        platform={props.platform}
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

function LetterFork({
  state,
  frozen,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
}) {
  return (
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
  );
}

function LetterDestinationSlot({
  state,
  vacancyUrl,
  frozen,
  actions,
  onOpenResume,
}: {
  readonly state: LetterScreenState;
  readonly vacancyUrl: string;
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
      vacancyUrl={vacancyUrl}
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
      resumeRow={resumeRowForLetter(state)}
      resumeBusy={state.approval.busy}
      onPrepareResume={() => void state.approval.prepareResume()}
      onAttachGeneralResume={() => void state.approval.attachGeneralResume()}
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

function isPitchReady(state: LetterScreenState): boolean {
  return (
    Boolean(state.draft.pitch && state.draft.text.trim()) &&
    !state.draft.loading &&
    !state.circles.loading &&
    !state.circles.error
  );
}

interface LetterCardProps {
  readonly state: LetterScreenState;
  readonly vacancyUrl: string;
  readonly frozen: boolean;
  readonly actions: ReturnType<typeof useLetterPageActions>;
  readonly platform?: LetterPlatform;
  readonly onOpenResponses?: () => void;
  readonly onOpenResume?: () => void;
}

function LetterCard(props: LetterCardProps) {
  const { state, vacancyUrl, frozen, actions, platform, onOpenResponses, onOpenResume } = props;
  const { circle } = state.circle;
  const compact = useCompactViewport();
  const pitchReady = isPitchReady(state);
  return (
    <section
      className="career-letter-card"
      id="career-letter-active-circle"
      role="tabpanel"
      aria-labelledby={`career-letter-tab-${circle}`}
    >
      <LetterCardHeading
        circle={circle}
        approved={frozen}
        summary={compact && !state.circles.loading ? circleSummary(state.circle.result) : undefined}
      />
      <LetterDestinationSlot
        state={state}
        vacancyUrl={vacancyUrl}
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
        platform={platform}
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
  const accountName = useCandidateDisplayName();
  // Письмо подписано именем из резюме; имя аккаунта только на случай, когда его там нет.
  const senderName = state.draft.pitch?.senderName?.trim() || accountName;
  if (!state.draft.pitch && !state.draft.error) return null;
  const editorFrozen = frozen || state.draft.loading;
  // Письма нет и править нечего: пустое поле под ошибкой выглядело бы как приглашение писать самому.
  const hasText = Boolean(state.draft.pitch || state.draft.text.trim());
  return (
    <>
      {hasText ? (
        <LetterEditor
          draft={state.draft}
          circle={state.circle.circle}
          senderName={senderName}
          frozen={editorFrozen}
          onEdit={state.approval.reset}
        />
      ) : null}
      {state.draft.pitch ? (
        <LetterNotices pitch={state.draft.pitch} onGatherFacts={onGatherFacts} />
      ) : null}
      <TariffQuotaNote quota="applications" refreshKey={state.draft.loading} />
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
      <CaretLeft size={18} aria-hidden="true" />
    </button>
  );
}

/** Макет 9 при 390: «Открыть вакансию» — строка списка, а не кнопка. */
function OpenVacancyRow({ url }: { readonly url: string }) {
  return (
    <button
      type="button"
      className="career-letter-open-row"
      onClick={() => void openExternalLink(url)}
    >
      <span className="career-letter-row-icon">
        <ArrowSquareOut size={18} aria-hidden="true" />
      </span>
      <strong>Открыть вакансию</strong>
      <CaretRight size={14} aria-hidden="true" />
    </button>
  );
}

function VacancyDescription({ summary }: { readonly summary: string }) {
  return (
    <details className="career-letter-description">
      <summary>
        <CaretRight size={14} aria-hidden="true" />
        Показать описание
      </summary>
      <p>{summary.trim() || 'Описание вакансии не указано.'}</p>
    </details>
  );
}

function VacancyCard({
  vacancy,
  compact,
  onBack,
}: {
  readonly vacancy: VacancyLetterTarget;
  readonly compact: boolean;
  readonly onBack?: () => void;
}) {
  const location = vacancy.canonicalLocation ?? 'Локация не указана';
  const sources = [
    ...new Set(
      vacancy.sources.flatMap((source) =>
        source.sourceName ? [vacancySourceDisplayName(source.sourceName)] : [],
      ),
    ),
  ];
  return (
    <section className="career-letter-vacancy" aria-label="Вакансия">
      {onBack ? <LetterBackButton onBack={onBack} /> : null}
      <div className="career-letter-vacancy-copy">
        <h2 id="career-letter-title">{vacancy.canonicalTitle}</h2>
        <p>
          {vacancy.canonicalCompany} · {location} ·{' '}
          {vacancy.isRemote === true ? 'Удалённо' : 'Формат не указан'}
          {sources.length ? ' · ' + sources.join(', ') : ''}
        </p>
        <VacancyDescription summary={vacancy.descriptionSummary} />
      </div>
      {vacancy.primaryUrl && compact ? <OpenVacancyRow url={vacancy.primaryUrl} /> : null}
      {vacancy.primaryUrl && !compact ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => void openExternalLink(vacancy.primaryUrl)}
        >
          <ArrowSquareOut size={16} aria-hidden="true" />
          Открыть вакансию
        </button>
      ) : null}
      {vacancy.primaryUrl ? null : (
        <p className="career-letter-muted">Ссылка на вакансию не указана.</p>
      )}
    </section>
  );
}
