import { useEffect, useRef } from 'react';
import type { ApprovalState, LetterDraftState, LetterScreenState } from './vacancyLetterController';
import { useVacancyLetterController } from './vacancyLetterController';
import {
  ArrowLeft,
  ArrowSquareOut,
  ChatCircleText,
  Check,
  CircleNotch,
  Info,
  WarningCircle,
} from '@phosphor-icons/react';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type {
  CandidateWorkplaceForLetter,
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCircleResult,
} from './vacancyLetterApi';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import './vacancy-letter.css';

type PitchTone = NonNullable<VacancyPitchPayload['tone']>;
type PitchLanguage = NonNullable<VacancyPitchPayload['language']>;

const CIRCLE_OPTIONS: readonly { readonly id: ConnectionCircleNumber; readonly label: string }[] = [
  { id: 1, label: 'Круг 1' },
  { id: 2, label: 'Круг 2' },
  { id: 3, label: 'Круг 3' },
];

const TONE_OPTIONS: readonly { readonly id: PitchTone; readonly label: string }[] = [
  { id: 'executive', label: 'Деловой' },
  { id: 'confident', label: 'Тёплый' },
  { id: 'technical', label: 'Технический' },
];

interface VacancyLetterScreenProps {
  readonly vacancy: MatchedVacancyItem['cluster'];
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
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

function ConnectionsError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }) {
  return (
    <div className="career-letter-error" role="alert">
      <WarningCircle size={16} aria-hidden="true" />
      <p>{error || 'Не удалось загрузить пути к контактам.'}</p>
      <button type="button" onClick={onRetry}>Повторить</button>
    </div>
  );
}

export function VacancyLetterScreen({
  vacancy,
  onBack,
  onOpenResponses,
  onOpenNetworking,
  onOpenExpert,
}: VacancyLetterScreenProps) {
  const state = useVacancyLetterController(vacancy.id);
  return (
    <VacancyLetterPage
      vacancy={vacancy}
      state={state}
      onBack={onBack}
      onOpenResponses={onOpenResponses}
      onOpenNetworking={onOpenNetworking}
      onOpenExpert={onOpenExpert}
    />
  );
}

function LetterConnectionState({
  vacancy,
  state,
  frozen,
  onOpenNetworking,
}: {
  readonly vacancy: MatchedVacancyItem['cluster'];
  readonly state: LetterScreenState;
  readonly frozen: boolean;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
}) {
  return (
    <>
      {state.circles.loading ? <ConnectionsLoading /> : null}
      {state.circles.error ? <ConnectionsError error={state.circles.error} onRetry={state.circles.retry} /> : null}
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
          onOpenNetworking={onOpenNetworking ? () => onOpenNetworking(vacancy) : undefined}
        />
      ) : null}
    </>
  );
}

function LetterDraftContent({ state, frozen }: { readonly state: LetterScreenState; readonly frozen: boolean }) {
  if (!state.draft.pitch) return null;
  return (
    <>
      <LetterEditor draft={state.draft} frozen={frozen} onEdit={state.approval.reset} />
      <WorkplaceList
        workplaces={state.draft.workplaces}
        includedIds={state.draft.includedIds}
        frozen={frozen}
        onToggle={(id) => {
          state.approval.reset();
          state.draft.toggle(id);
        }}
      />
      <LetterNotices pitch={state.draft.pitch} language={state.language} />
    </>
  );
}

function selectLetterCircle(state: LetterScreenState, circle: ConnectionCircleNumber) {
  state.approval.reset();
  state.circle.setCircle(circle);
  state.circle.setSelectedPathId(null);
}

function VacancyLetterPage({
  vacancy,
  state,
  onBack,
  onOpenResponses,
  onOpenNetworking,
  onOpenExpert,
}: {
  readonly vacancy: MatchedVacancyItem['cluster'];
  readonly state: LetterScreenState;
  readonly onBack: () => void;
  readonly onOpenResponses?: () => void;
  readonly onOpenNetworking?: (vacancy: MatchedVacancyItem['cluster']) => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const frozen = Boolean(state.approval.saved);
  return (
    <section className="career-letter-screen" aria-labelledby="career-letter-title">
      <LetterHeader vacancy={vacancy} onBack={onBack} />
      <CircleTabs
        selected={state.circle.circle}
        frozen={frozen}
        onSelect={(circle) => selectLetterCircle(state, circle)}
      />
      <LetterConnectionState vacancy={vacancy} state={state} frozen={frozen} onOpenNetworking={onOpenNetworking} />
      <LetterSettings
        language={state.language}
        tone={state.tone}
        frozen={frozen}
        onLanguage={(value) => { state.approval.reset(); state.setLanguage(value); }}
        onTone={(value) => { state.approval.reset(); state.setTone(value); }}
      />
      <PitchBodyState draft={state.draft} />
      <LetterDraftContent state={state} frozen={frozen} />
      <LetterActions
        approval={state.approval}
        pitchReady={Boolean(state.draft.pitch && state.draft.text.trim())}
        onAskEdits={onOpenExpert
          ? () => onOpenExpert('vacancies', { kind: 'vacancy', id: vacancy.id }, 'Правки письма: ' + vacancy.canonicalTitle)
          : undefined}
        onOpenResponses={onOpenResponses}
        onEdit={state.approval.reset}
      />
    </section>
  );
}

function LetterHeader({
  vacancy,
  onBack,
}: {
  readonly vacancy: MatchedVacancyItem['cluster'];
  readonly onBack: () => void;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const location = vacancy.canonicalLocation ?? 'Локация не указана';
  const sources = vacancy.sources.map((source) => source.sourceName).filter(Boolean);
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
      <section className="career-letter-vacancy" aria-label="Вакансия">
        <div className="career-letter-vacancy-copy">
          <h2>{vacancy.canonicalTitle}</h2>
          <p>{vacancy.canonicalCompany} · {location} · {vacancy.isRemote ? 'Удалённо' : 'Формат не указан'}{sources.length ? ' · ' + sources.join(', ') : ''}</p>
        </div>
        {vacancy.primaryUrl ? (
          <button type="button" className="career-btn career-btn-secondary" onClick={() => void openExternalLink(vacancy.primaryUrl)}>
            <ArrowSquareOut size={16} aria-hidden="true" />
            Открыть вакансию
          </button>
        ) : <p className="career-letter-muted">Ссылка на вакансию не указана.</p>}
      </section>
    </header>
  );
}

function CircleTabs({
  selected,
  frozen,
  onSelect,
}: {
  readonly selected: ConnectionCircleNumber;
  readonly frozen: boolean;
  readonly onSelect: (circle: ConnectionCircleNumber) => void;
}) {
  return (
    <div className="career-letter-circles" role="group" aria-label="Круг связей">
      {CIRCLE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={selected === option.id}
          className={selected === option.id ? 'is-selected' : ''}
          disabled={frozen}
          onClick={() => onSelect(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CircleEmptyState({
  circle,
  summary,
  onShowPaths,
  onOpenNetworking,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly summary: string;
  readonly onShowPaths: () => void;
  readonly onOpenNetworking?: () => void;
}) {
  return (
    <div className="career-letter-circle-empty" role="status">
      <Info size={16} aria-hidden="true" />
      <span>{summary}</span>
      <div className="career-letter-empty-actions">
        {circle === 1 ? <button type="button" className="career-btn career-btn-secondary" onClick={onShowPaths}>Показать пути</button> : null}
        {circle === 1 && onOpenNetworking ? (
          <button type="button" className="career-btn career-btn-secondary" onClick={onOpenNetworking}>Добавить контакт</button>
        ) : null}
      </div>
    </div>
  );
}

function LetterCircleHeading({
  circle,
  result,
  path,
  frozen,
  onSelectPath,
  onShowPaths,
  onOpenNetworking,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path?: ConnectionCirclePath;
  readonly frozen: boolean;
  readonly onSelectPath: (pathId: string) => void;
  readonly onShowPaths: () => void;
  readonly onOpenNetworking?: () => void;
}) {
  const title = circle === 1 ? 'Написать знакомому' : circle === 2 ? 'Попросить представить' : 'Холодный отклик';
  const summary = result?.message || fallbackCircleMessage(result?.state);
  const isEmpty = result?.state !== 'available' || result.paths.length === 0;
  return (
    <section className="career-letter-circle-section" aria-label={title}>
      <div className="career-letter-circle-heading">
        <h2>{title}</h2>
        <p>{summary}</p>
      </div>
      {isEmpty ? (
        <CircleEmptyState
          circle={circle}
          summary={summary}
          onShowPaths={onShowPaths}
          onOpenNetworking={onOpenNetworking}
        />
      ) : (
        <ConnectionPathPicker
          circle={circle}
          paths={result.paths}
          selected={path?.id}
          disabled={frozen}
          onSelect={onSelectPath}
        />
      )}
      {circle === 3 ? <ColdOutreachSummary /> : null}
    </section>
  );
}

function fallbackCircleMessage(state?: ConnectionCircleResult['state']): string {
  if (state === 'unknown') return 'Импортированные связи не подтверждены; путь неизвестен.';
  if (state === 'none') return 'В доступных кандидатских связях знакомых не найдено.';
  return 'Выберите путь, по которому хотите подготовить письмо.';
}

function ConnectionPathPicker({
  circle,
  paths,
  selected,
  disabled,
  onSelect,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly paths: readonly ConnectionCirclePath[];
  readonly selected?: string;
  readonly disabled: boolean;
  readonly onSelect: (pathId: string) => void;
}) {
  const label = circle === 2 ? 'Через кого попросить' : circle === 3 ? 'Кому адресовать' : 'Кому написать';
  return (
    <fieldset className="career-letter-path-picker" disabled={disabled}>
      <legend>{label}</legend>
      {paths.map((path) => {
        const chain = [...path.path.map((person) => person.fullName), path.recipient.fullName]
          .filter(Boolean)
          .join(' → ');
        return (
          <label key={path.id} className="career-letter-path-option">
            <input
              type="radio"
              name="vacancy-letter-connection-path"
              value={path.id}
              checked={selected === path.id}
              onChange={() => onSelect(path.id)}
            />
            <span className="career-letter-path-copy">
              <strong>{path.recipient.fullName}</strong>
              <span>{path.recipient.roleTitle ?? 'Роль не указана'}{path.recipient.companyName ? ' · ' + path.recipient.companyName : ''}</span>
              {circle === 2 && chain ? <span>Путь: {chain}</span> : null}
              <span>{path.evidence.join(' · ') || strengthLabel(path.strength)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function strengthLabel(strength: ConnectionCirclePath['strength']): string {
  if (strength === 'weak') return 'Слабая связь';
  if (strength === 'direct') return 'Прямой контакт';
  if (strength === 'strong') return 'Сильная связь';
  return 'Сила связи неизвестна';
}

function ColdOutreachSummary() {
  return (
    <div className="career-letter-delivery-summary" aria-label="Куда и что отправим">
      <h3>Куда и что отправим</h3>
      <div className="career-letter-delivery-item">
        <strong>Резюме под вакансию</strong>
        <span>Резюме из профиля; неподтверждённые факты не добавляются.</span>
      </div>
      <div className="career-letter-delivery-item">
        <strong>Отклик с письмом</strong>
        <span>Черновик будет сохранён в «Откликах». Ничего не отправляется при одобрении.</span>
      </div>
    </div>
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
        <select value={language} disabled={frozen} onChange={(event) => onLanguage(event.currentTarget.value as 'auto' | PitchLanguage)}>
          <option value="auto">Определить по вакансии</option>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        Тон
        <select value={tone} disabled={frozen} onChange={(event) => onTone(event.currentTarget.value as PitchTone)}>
          {TONE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function PitchBodyState({ draft }: { readonly draft: LetterDraftState }) {
  if (draft.loading) {
    return <p className="career-letter-loading" role="status" aria-busy="true"><CircleNotch size={16} className="career-spin" aria-hidden="true" /> Письмо готовится по профилю и вакансии…</p>;
  }
  if (draft.error) {
    return <div className="career-letter-error" role="alert"><WarningCircle size={16} aria-hidden="true" /><p>{draft.error}</p><button type="button" onClick={draft.retry}>Повторить</button></div>;
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
        onChange={(event) => { onEdit(); draft.setText(event.currentTarget.value); }}
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
  const range = [workplace.startDate, workplace.current ? 'сейчас' : workplace.endDate].filter(Boolean).join(' — ');
  return (
    <li>
      <label>
        <input type="checkbox" checked={checked} disabled={frozen || workplace.evidenceIds.length === 0} onChange={onToggle} />
        <span>
          <strong>{workplace.employer ?? 'Работодатель не указан'}</strong>
          <span>{workplace.title ?? 'Должность не указана'}{range ? ' · ' + range : ''}</span>
          {workplace.evidenceIds.length === 0 ? <small>Нет подтверждённых фактов для письма</small> : null}
        </span>
        <span className="career-letter-fact-count">{workplace.evidenceIds.length ? workplace.evidenceIds.length + ' факта' : 'Не включено'}</span>
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
        <p className="career-letter-muted">В профиле нет подтверждённых мест работы. Письмо не будет добавлять неподтверждённый опыт.</p>
      ) : (
        <ul>{workplaces.map((workplace) => (
          <WorkplaceRow
            key={workplace.id}
            workplace={workplace}
            checked={includedIds.includes(workplace.id)}
            frozen={frozen}
            onToggle={() => onToggle(workplace.id)}
          />
        ))}</ul>
      )}
    </section>
  );
}

function LetterNotices({
  pitch,
  language,
}: {
  readonly pitch: VacancyPitchResult;
  readonly language: 'auto' | PitchLanguage;
}) {
  const notices = pitch.notices ?? [];
  const fewFacts = pitch.usedEvidenceIds.length === 0;
  return (
    <>
      {language === 'en' || pitch.language === 'en' ? (
        <p className="career-letter-partial" role="status">Частично: язык English</p>
      ) : null}
      {notices.map((notice) => <p key={notice} className="career-letter-notice">{notice}</p>)}
      {fewFacts ? <p className="career-letter-notice" role="status">В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.</p> : null}
    </>
  );
}

function ApprovedLetterActions({
  onOpenResponses,
  onEdit,
}: {
  readonly onOpenResponses?: () => void;
  readonly onEdit: () => void;
}) {
  return (
    <div className="career-letter-approved" role="status">
      <Check size={16} aria-hidden="true" />
      <span>Одобрено и сохранено в «Откликах». Ничего не отправлено.</span>
      {onOpenResponses ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onOpenResponses}>Отклики</button>
      ) : null}
      <button type="button" className="career-btn career-btn-secondary" onClick={onEdit}>Новый черновик</button>
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
  onEdit,
}: {
  readonly approval: ApprovalState;
  readonly pitchReady: boolean;
  readonly onAskEdits?: () => void;
  readonly onOpenResponses?: () => void;
  readonly onEdit: () => void;
}) {
  return (
    <footer className="career-letter-actions">
      {approval.error ? <p role="alert">{approval.error}</p> : null}
      {approval.saved ? (
        <ApprovedLetterActions onOpenResponses={onOpenResponses} onEdit={onEdit} />
      ) : (
        <DraftLetterActions approval={approval} pitchReady={pitchReady} onAskEdits={onAskEdits} />
      )}
      {!approval.saved ? (
        <p className="career-letter-footnote">
          Черновик, ничего не отправлено. Отправка возможна только из очереди, после вашего одобрения.
        </p>
      ) : null}
    </footer>
  );
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
