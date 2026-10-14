import { useEffect, useRef, useState } from 'react';
import type { ApprovalState, LetterDraftState, LetterScreenState } from './vacancyLetterController';
import { useVacancyLetterController } from './vacancyLetterController';
import {
  ArrowLeft,
  ArrowSquareOut,
  ChatCircleText,
  Check,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { ConnectionContactsDialog } from '../outreach/ConnectionContactsDialog';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type { CandidateWorkplaceForLetter, ConnectionCircleNumber } from './vacancyLetterApi';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import { CircleTabs, LetterCircleHeading } from './VacancyLetterCircles';
import './vacancy-letter.css';

type PitchTone = NonNullable<VacancyPitchPayload['tone']>;
type PitchLanguage = NonNullable<VacancyPitchPayload['language']>;

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

const TONE_OPTIONS: readonly { readonly id: PitchTone; readonly label: string }[] = [
  { id: 'executive', label: 'Деловой' },
  { id: 'confident', label: 'Тёплый' },
  { id: 'technical', label: 'Технический' },
];

interface VacancyLetterScreenProps {
  readonly vacancy: VacancyLetterTarget;
  readonly initialCircle?: ConnectionCircleNumber;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
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
  onOpenExpert,
}: VacancyLetterScreenProps) {
  const state = useVacancyLetterController(vacancy.id, initialCircle);
  return (
    <VacancyLetterPage
      vacancy={vacancy}
      state={state}
      onBack={onBack}
      onOpenResponses={onOpenResponses}
      onOpenExpert={onOpenExpert}
    />
  );
}

function LetterConnectionState({
  state,
  frozen,
  onOpenContacts,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly onOpenContacts: () => void;
}) {
  return (
    <>
      {state.circles.loading ? <ConnectionsLoading /> : null}
      {state.circles.error ? (
        <ConnectionsError error={state.circles.error} onRetry={state.circles.retry} />
      ) : null}
      {!state.circles.loading && !state.circles.error ? (
        <LetterCircleHeading
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
          onOpenContacts={onOpenContacts}
        />
      ) : null}
    </>
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
  if (!state.draft.pitch && !state.draft.error) return null;
  const editorFrozen = frozen || state.draft.loading;
  return (
    <>
      <LetterEditor draft={state.draft} frozen={editorFrozen} onEdit={state.approval.reset} />
      {state.draft.pitch ? (
        <>
          <WorkplaceList
            workplaces={state.draft.workplaces}
            includedIds={state.draft.includedIds}
            frozen={editorFrozen}
            onToggle={(id) => {
              state.approval.reset();
              state.draft.toggle(id);
            }}
          />
          <LetterNotices
            pitch={state.draft.pitch}
            language={state.language}
            onGatherFacts={onGatherFacts}
          />
        </>
      ) : null}
    </>
  );
}

function selectLetterCircle(state: LetterScreenState, circle: ConnectionCircleNumber) {
  state.approval.reset();
  state.circle.setCircle(circle);
  state.circle.setSelectedPathId(null);
}

interface LetterPageActionProps {
  readonly vacancy: VacancyLetterTarget;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}

interface VacancyLetterPageProps extends LetterPageActionProps {
  readonly state: LetterScreenState;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
}

function useLetterPageActions({ vacancy, onOpenExpert }: LetterPageActionProps) {
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

function VacancyLetterPage({
  vacancy,
  state,
  onBack,
  onOpenResponses,
  onOpenExpert,
}: VacancyLetterPageProps) {
  const actions = useLetterPageActions({ vacancy, onOpenExpert });
  const frozen = Boolean(state.approval.saved);
  return (
    <section className="career-letter-screen" aria-labelledby="career-letter-title">
      <LetterHeader vacancy={vacancy} onBack={onBack} />
      <LetterPageControls state={state} frozen={frozen} onOpenContacts={actions.openContacts} />
      <PitchBodyState draft={state.draft} />
      <LetterDraftContent state={state} frozen={frozen} onGatherFacts={actions.onGatherFacts} />
      <LetterActions
        approval={state.approval}
        pitchReady={
          Boolean(state.draft.pitch && state.draft.text.trim()) &&
          !state.draft.loading &&
          !state.circles.loading &&
          !state.circles.error
        }
        onAskEdits={actions.onAskEdits}
        onOpenResponses={onOpenResponses}
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

function LetterPageControls({
  state,
  frozen,
  onOpenContacts,
}: {
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly onOpenContacts: () => void;
}) {
  return (
    <>
      <CircleTabs
        selected={state.circle.circle}
        circles={state.circles.data?.circles ?? []}
        frozen={frozen}
        onSelect={(circle) => selectLetterCircle(state, circle)}
      />
      <LetterConnectionState state={state} frozen={frozen} onOpenContacts={onOpenContacts} />
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
    </>
  );
}

function LetterHeader({
  vacancy,
  onBack,
}: {
  readonly vacancy: VacancyLetterTarget;
  readonly onBack: () => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);
  return (
    <header className="career-letter-header">
      <div className="career-letter-title-row">
        <button
          ref={backButtonRef}
          type="button"
          className="career-btn is-icon is-ghost career-letter-back"
          onClick={onBack}
          aria-label="Назад к вакансиям"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <h1 id="career-letter-title">Письмо под вакансию</h1>
      </div>
      <VacancyCard vacancy={vacancy} />
    </header>
  );
}

function VacancyCard({ vacancy }: { readonly vacancy: VacancyLetterTarget }) {
  const location = vacancy.canonicalLocation ?? 'Локация не указана';
  const sources = vacancy.sources.map((source) => source.sourceName).filter(Boolean);
  return (
    <section className="career-letter-vacancy" aria-label="Вакансия">
      <div className="career-letter-vacancy-copy">
        <h2>{vacancy.canonicalTitle}</h2>
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

function LetterSettings({
  language,
  tone,
  frozen,
  onLanguage,
  onTone,
}: {
  readonly language: 'auto' | PitchLanguage;
  readonly tone: PitchTone;
  readonly frozen: boolean;
  readonly onLanguage: (language: 'auto' | PitchLanguage) => void;
  readonly onTone: (tone: PitchTone) => void;
}) {
  return (
    <div className="career-letter-settings">
      <label>
        Язык
        <select
          value={language}
          disabled={frozen}
          onChange={(event) => onLanguage(event.currentTarget.value as 'auto' | PitchLanguage)}
        >
          <option value="auto">Определить по вакансии</option>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        Тон
        <select
          value={tone}
          disabled={frozen}
          onChange={(event) => onTone(event.currentTarget.value as PitchTone)}
        >
          {TONE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PitchBodyState({ draft }: { readonly draft: LetterDraftState }) {
  if (draft.loading) {
    return (
      <p className="career-letter-loading" role="status" aria-busy="true">
        <CircleNotch size={16} className="career-spin" aria-hidden="true" /> Письмо готовится по
        профилю и вакансии…
      </p>
    );
  }
  if (draft.error) {
    return (
      <div className="career-letter-error" role="alert">
        <WarningCircle size={16} aria-hidden="true" />
        <p>{draft.error}</p>
        <button type="button" onClick={draft.retry}>
          Повторить
        </button>
      </div>
    );
  }
  return null;
}

function LetterEditor({
  draft,
  frozen,
  onEdit,
}: {
  readonly draft: LetterDraftState;
  readonly frozen: boolean;
  readonly onEdit: () => void;
}) {
  return (
    <label className="career-letter-editor">
      Текст письма
      <textarea
        value={draft.text}
        readOnly={frozen}
        rows={12}
        onChange={(event) => {
          onEdit();
          draft.setText(event.currentTarget.value);
        }}
        aria-label="Текст письма"
      />
      <span>{wordCount(draft.text)} слов · письмо опирается только на выбранные факты</span>
    </label>
  );
}

function WorkplaceRow({
  workplace,
  checked,
  frozen,
  onToggle,
}: {
  readonly workplace: CandidateWorkplaceForLetter;
  readonly checked: boolean;
  readonly frozen: boolean;
  readonly onToggle: () => void;
}) {
  const range = [workplace.startDate, workplace.current ? 'сейчас' : workplace.endDate]
    .filter(Boolean)
    .join(' — ');
  return (
    <li>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={frozen || workplace.evidenceIds.length === 0}
          onChange={onToggle}
        />
        <span>
          <strong>{workplace.employer ?? 'Работодатель не указан'}</strong>
          <span>
            {workplace.title ?? 'Должность не указана'}
            {range ? ' · ' + range : ''}
          </span>
          {workplace.evidenceIds.length === 0 ? (
            <small>Нет подтверждённых фактов для письма</small>
          ) : null}
        </span>
        <span className="career-letter-fact-count">
          {workplace.evidenceIds.length ? workplace.evidenceIds.length + ' факта' : 'Не включено'}
        </span>
      </label>
    </li>
  );
}

function WorkplaceList({
  workplaces,
  includedIds,
  frozen,
  onToggle,
}: {
  readonly workplaces: readonly CandidateWorkplaceForLetter[];
  readonly includedIds: readonly string[];
  readonly frozen: boolean;
  readonly onToggle: (id: string) => void;
}) {
  return (
    <section className="career-letter-workplaces" aria-label="Места работы в письме">
      <div className="career-letter-section-title">
        <h2>Места работы в письме</h2>
        <span>Отмеченные места можно включить в письмо</span>
      </div>
      {workplaces.length === 0 ? (
        <p className="career-letter-muted">
          В профиле нет подтверждённых мест работы. Письмо не будет добавлять неподтверждённый опыт.
        </p>
      ) : (
        <ul>
          {workplaces.map((workplace) => (
            <WorkplaceRow
              key={workplace.id}
              workplace={workplace}
              checked={includedIds.includes(workplace.id)}
              frozen={frozen}
              onToggle={() => onToggle(workplace.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LetterNotices({
  pitch,
  language,
  onGatherFacts,
}: {
  readonly pitch: VacancyPitchResult;
  readonly language: 'auto' | PitchLanguage;
  readonly onGatherFacts?: () => void;
}) {
  const notices = pitch.notices ?? [];
  const fewFacts = pitch.usedEvidenceIds.length === 0;
  return (
    <>
      {language === 'en' || pitch.language === 'en' ? (
        <p className="career-letter-partial" role="status">
          Частично: язык English
        </p>
      ) : null}
      {notices.map((notice) => (
        <p key={notice} className="career-letter-notice">
          {notice}
        </p>
      ))}
      {fewFacts ? (
        <div className="career-letter-facts-notice">
          <p className="career-letter-notice" role="status">
            В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.
          </p>
          {onGatherFacts ? (
            <button
              type="button"
              className="career-btn career-btn-secondary"
              onClick={onGatherFacts}
            >
              <ChatCircleText size={16} aria-hidden="true" />
              Собрать факты с консультантом
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ApprovedLetterActions({
  onOpenResponses,
  approvedAt,
}: {
  readonly onOpenResponses?: () => void;
  readonly approvedAt: string;
}) {
  const date = new Date(approvedAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
  return (
    <div className="career-letter-approved" role="status">
      <Check size={16} aria-hidden="true" />
      <span>
        Письмо одобрено
        {dateLabel ? (
          <>
            {' '}
            <time dateTime={approvedAt}>{dateLabel}</time>
          </>
        ) : null}
        . Заявка сохранена в «Откликах». Ничего не отправлено.
      </span>
      {onOpenResponses ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onOpenResponses}>
          Отклики
        </button>
      ) : null}
    </div>
  );
}

function DraftLetterActions({
  approval,
  pitchReady,
  onAskEdits,
}: {
  readonly approval: ApprovalState;
  readonly pitchReady: boolean;
  readonly onAskEdits?: () => void;
}) {
  return (
    <div className="career-letter-action-row">
      <button
        type="button"
        className="career-btn career-btn-primary"
        disabled={!pitchReady}
        aria-busy={approval.busy}
        onClick={() => void approval.approve()}
      >
        {approval.busy ? 'Сохраняем снимок…' : 'Одобрить письмо'}
      </button>
      {onAskEdits ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onAskEdits}>
          <ChatCircleText size={16} aria-hidden="true" />
          Попросить правки у консультанта
        </button>
      ) : (
        <span className="career-letter-muted">Консультант недоступен из этого раздела.</span>
      )}
    </div>
  );
}

function LetterActions({
  approval,
  pitchReady,
  onAskEdits,
  onOpenResponses,
}: {
  readonly approval: ApprovalState;
  readonly pitchReady: boolean;
  readonly onAskEdits?: () => void;
  readonly onOpenResponses?: () => void;
}) {
  return (
    <footer className="career-letter-actions">
      {approval.error ? <p role="alert">{approval.error}</p> : null}
      {approval.saved ? (
        <ApprovedLetterActions
          onOpenResponses={onOpenResponses}
          approvedAt={approval.saved.approvedAt}
        />
      ) : (
        <DraftLetterActions approval={approval} pitchReady={pitchReady} onAskEdits={onAskEdits} />
      )}
      {!approval.saved ? (
        <p className="career-letter-footnote">
          Черновик, ничего не отправлено. Отправка возможна только из очереди, после вашего
          одобрения.
        </p>
      ) : null}
    </footer>
  );
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
