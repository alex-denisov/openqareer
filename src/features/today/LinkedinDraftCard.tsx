import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { PaywallModal } from '../tariffs/PaywallModal';
import {
  createDraft,
  dismissDraftTopic,
  DraftApiError,
  listDrafts,
  listDraftTopics,
  updateDraft,
  type LinkedinDraft,
  type LinkedinDraftStatus,
  type LinkedinDraftTopic,
  type LinkedinDraftTopicPage,
} from './linkedinDraftApi';
import type { LinkedinSafetyStopReason } from './linkedinActionSafetyApi';
import { useLinkedinActionSafetyStop } from './useLinkedinActionSafetyStop';
import './linkedinDraftCard.css';

const STATUS: Record<LinkedinDraftStatus, string> = {
  draft: 'ждёт вашей правки',
  copied: 'скопирован',
  rejected: 'отклонён',
  approved: 'одобрено вами',
  published: 'опубликовано по вашему подтверждению',
};
const GENERATION_ERROR = 'Не получилось подготовить черновик. Попробуйте ещё раз';
const TOPICS_PAGE_SIZE = 3;
const emptyTopics: LinkedinDraftTopicPage = {
  items: [],
  total: 0,
  cadence: {
    timezone: 'Europe/Moscow',
    lastPublishedAt: null,
    nextAllowedAt: null,
    canPublish: true,
  },
};

function linkedinStopCopy(reason: LinkedinSafetyStopReason | null): string {
  switch (reason) {
    case 'challenge_required':
      return 'LinkedIn запросил проверку. Завершите её вручную перед возобновлением.';
    case 'platform_restricted':
      return 'LinkedIn ограничил запрос. Проверьте подключение перед возобновлением.';
    case 'unexpected_page':
      return 'Получен неожиданный ответ LinkedIn. Проверьте его вручную перед возобновлением.';
    case 'provider_error':
      return 'Исполнитель не подтвердил результат. Действия ждут ручной проверки.';
    case 'manual_pause':
      return 'Пауза включена вручную.';
    case 'platform_pause':
      return 'Пауза действует на уровне сервиса; снять её может администратор.';
    default:
      return 'Действия остановлены до ручной проверки.';
  }
}

function topicForText(value: string): string {
  const firstLine =
    value
      .trim()
      .split(/[\n.!?]/u, 1)[0]
      ?.trim() ?? '';
  return firstLine.slice(0, 200) || 'Черновик LinkedIn';
}

type DraftCardState = {
  kind: LinkedinDraft['kind'];
  inputType: 'topic' | 'text' | 'sketch';
  tone: 'business' | 'personal' | 'expert';
  length: 'short' | 'medium' | 'long';
  topicText: string;
  sourceText: string;
  drafts: readonly LinkedinDraft[];
  visibleDraftCount: number;
  topics: readonly LinkedinDraftTopic[];
  topicTotal: number;
  cadence: LinkedinDraftTopicPage['cadence'];
  draftsLoading: boolean;
  topicsLoading: boolean;
  busy: boolean;
  busyDraftId: string | null;
  busyTopicId: string | null;
  editingId: string | null;
  editText: string;
  error: string;
  topicsError: string;
  draftsError: string;
  notice: string;
  publishDraft: LinkedinDraft | null;
  paywall: boolean;
  hasMoreTopics: boolean;
};

type DraftCardSetter = Dispatch<SetStateAction<DraftCardState>>;

function initialDraftCardState(): DraftCardState {
  return {
    kind: 'comment',
    inputType: 'topic',
    tone: 'business',
    length: 'medium',
    topicText: '',
    sourceText: '',
    drafts: [],
    visibleDraftCount: 3,
    topics: [],
    topicTotal: 0,
    cadence: emptyTopics.cadence,
    draftsLoading: true,
    topicsLoading: true,
    busy: false,
    busyDraftId: null,
    busyTopicId: null,
    editingId: null,
    editText: '',
    error: '',
    topicsError: '',
    draftsError: '',
    notice: '',
    publishDraft: null,
    paywall: false,
    hasMoreTopics: false,
  };
}

function patchDraftCard(setState: DraftCardSetter, patch: Partial<DraftCardState>) {
  setState((state) => ({ ...state, ...patch }));
}

function useInitialDraftData(setState: DraftCardSetter) {
  useEffect(() => {
    const active = { current: true };
    void loadInitialDrafts(active, setState).finally(() => {
      if (active.current) patchDraftCard(setState, { draftsLoading: false });
    });
    void loadInitialTopics(active, setState).finally(() => {
      if (active.current) patchDraftCard(setState, { topicsLoading: false });
    });
    return () => {
      active.current = false;
    };
  }, [setState]);
}

async function loadInitialDrafts(active: { current: boolean }, setState: DraftCardSetter) {
  try {
    const drafts = await listDrafts();
    if (active.current) patchDraftCard(setState, { drafts: Array.isArray(drafts) ? drafts : [] });
  } catch {
    if (active.current) patchDraftCard(setState, { draftsError: 'Не получилось загрузить последние черновики.' });
  }
}

async function loadInitialTopics(active: { current: boolean }, setState: DraftCardSetter) {
  try {
    const page = await listDraftTopics(TOPICS_PAGE_SIZE, 0);
    if (active.current)
      patchDraftCard(setState, {
        topics: page.items,
        topicTotal: page.total,
        cadence: page.cadence,
        hasMoreTopics: page.items.length < page.total,
      });
  } catch {
    if (active.current) patchDraftCard(setState, { topicsError: 'Не получилось загрузить темы по данным профиля.' });
  }
}

function rememberDraft(setState: DraftCardSetter, draft: LinkedinDraft) {
  setState((state) => ({
    ...state,
    drafts: [draft, ...state.drafts.filter((item) => item.id !== draft.id)].slice(0, 20),
  }));
}

function removeTopic(setState: DraftCardSetter, topicId: string) {
  setState((state) => ({
    ...state,
    topics: state.topics.filter((topic) => topic.id !== topicId),
    topicTotal: Math.max(0, state.topicTotal - 1),
  }));
}

async function createDraftFromInput(state: DraftCardState, setState: DraftCardSetter, event: FormEvent | null, selectedTopic?: LinkedinDraftTopic) {
  event?.preventDefault();
  const value = selectedTopic?.title ?? state.topicText.trim();
  if (!value || state.busy) return;
  patchDraftCard(setState, { busy: true, error: '', notice: '' });
  try {
    const sourceText = state.inputType === 'topic' ? (selectedTopic ? undefined : state.kind === 'comment' ? state.sourceText.trim() : undefined) : value;
    const draft = await createDraft({
      kind: selectedTopic ? 'post' : state.kind,
      topic: state.inputType === 'topic' || selectedTopic ? value.slice(0, 200) : topicForText(value),
      ...(selectedTopic ? { topicId: selectedTopic.id } : {}),
      ...(sourceText ? { sourceText } : {}),
      inputType: selectedTopic ? 'topic' : state.inputType,
      tone: state.tone,
      length: state.length,
    });
    rememberDraft(setState, draft);
    patchDraftCard(setState, { notice: 'Черновик готов. Проверьте текст перед одобрением.' });
    if (selectedTopic) removeTopic(setState, selectedTopic.id);
  } catch (error) {
    handleGenerationError(setState, error);
  } finally {
    patchDraftCard(setState, { busy: false });
  }
}

function handleGenerationError(setState: DraftCardSetter, error: unknown) {
  if (error instanceof DraftApiError && error.status === 402) patchDraftCard(setState, { paywall: true });
  else
    patchDraftCard(setState, {
      error: error instanceof DraftApiError && [429, 503].includes(error.status) ? error.message : GENERATION_ERROR,
    });
}

async function updateDraftStatus(state: DraftCardState, setState: DraftCardSetter, draft: LinkedinDraft, status: 'copied' | 'rejected' | 'approved') {
  if (state.busyDraftId) return;
  patchDraftCard(setState, { busyDraftId: draft.id, error: '', notice: '' });
  try {
    if (status === 'copied') await navigator.clipboard.writeText(draft.text);
    const updated = await updateDraft(draft.id, { status });
    rememberDraft(setState, updated);
    patchDraftCard(setState, {
      notice: status === 'approved' ? 'Черновик одобрен. Публикуете вы сами.' : status === 'copied' ? 'Текст скопирован.' : 'Черновик отклонён.',
    });
  } catch {
    patchDraftCard(setState, {
      error: status === 'copied' ? 'Не получилось скопировать и сохранить статус. Попробуйте ещё раз.' : 'Не получилось обновить черновик. Попробуйте ещё раз.',
    });
  } finally {
    patchDraftCard(setState, { busyDraftId: null });
  }
}

async function saveDraftEdit(state: DraftCardState, setState: DraftCardSetter, draft: LinkedinDraft) {
  if (state.busyDraftId || !state.editText.trim()) return;
  patchDraftCard(setState, { busyDraftId: draft.id, error: '' });
  try {
    const updated = await updateDraft(draft.id, { text: state.editText.trim() });
    rememberDraft(setState, updated);
    patchDraftCard(setState, {
      editingId: null,
      notice: 'Правка сохранена. Черновик нужно одобрить заново.',
    });
  } catch {
    patchDraftCard(setState, { error: 'Не получилось сохранить правку. Попробуйте ещё раз.' });
  } finally {
    patchDraftCard(setState, { busyDraftId: null });
  }
}

async function openApprovedDraft(state: DraftCardState, setState: DraftCardSetter, draft: LinkedinDraft) {
  if (!state.cadence.canPublish || draft.status !== 'approved') return;
  patchDraftCard(setState, { busyDraftId: draft.id, error: '' });
  try {
    await navigator.clipboard.writeText(draft.text);
    window.open('https://www.linkedin.com/feed/', '_blank', 'noopener,noreferrer');
    patchDraftCard(setState, {
      notice: 'Текст скопирован. Опубликуйте его в LinkedIn самостоятельно.',
    });
  } catch {
    patchDraftCard(setState, { error: 'Не получилось скопировать текст. Попробуйте ещё раз.' });
  } finally {
    patchDraftCard(setState, { busyDraftId: null });
  }
}

async function confirmManualPublication(state: DraftCardState, setState: DraftCardSetter) {
  const draft = state.publishDraft;
  if (!draft) return;
  patchDraftCard(setState, { busyDraftId: draft.id, error: '' });
  try {
    const updated = await updateDraft(draft.id, { status: 'published' });
    rememberDraft(setState, updated);
    patchDraftCard(setState, {
      publishDraft: null,
      notice: 'Отмечено опубликованным по вашему подтверждению.',
    });
    await refreshCadence(setState);
  } catch (error) {
    patchDraftCard(setState, {
      error:
        error instanceof DraftApiError && error.status === 409 ? error.message : 'Не получилось отметить публикацию. Проверьте журнал и повторите попытку.',
    });
  } finally {
    patchDraftCard(setState, { busyDraftId: null });
  }
}

async function refreshCadence(setState: DraftCardSetter) {
  try {
    const page = await listDraftTopics(TOPICS_PAGE_SIZE, 0);
    patchDraftCard(setState, {
      cadence: page.cadence,
      topics: page.items,
      topicTotal: page.total,
      hasMoreTopics: page.items.length < page.total,
    });
  } catch {
    patchDraftCard(setState, {
      topicsError: 'Статус публикации сохранён; не удалось обновить темы.',
    });
  }
}

async function hideTopic(setState: DraftCardSetter, topic: LinkedinDraftTopic) {
  patchDraftCard(setState, { busyTopicId: topic.id, topicsError: '' });
  try {
    await dismissDraftTopic(topic.id);
    removeTopic(setState, topic.id);
  } catch {
    patchDraftCard(setState, { topicsError: 'Не получилось скрыть тему. Попробуйте ещё раз.' });
  } finally {
    patchDraftCard(setState, { busyTopicId: null });
  }
}

async function loadMoreTopics(state: DraftCardState, setState: DraftCardSetter) {
  patchDraftCard(setState, { topicsLoading: true, topicsError: '' });
  try {
    const page = await listDraftTopics(TOPICS_PAGE_SIZE, state.topics.length);
    setState((current) => ({
      ...current,
      topics: [...current.topics, ...page.items],
      topicTotal: page.total,
      cadence: page.cadence,
      hasMoreTopics: current.topics.length + page.items.length < page.total,
    }));
  } catch {
    patchDraftCard(setState, {
      topicsError: 'Не получилось загрузить следующие темы. Попробуйте ещё раз.',
    });
  } finally {
    patchDraftCard(setState, { topicsLoading: false });
  }
}

async function loadMoreDrafts(setState: DraftCardSetter) {
  patchDraftCard(setState, { draftsLoading: true, draftsError: '' });
  try {
    const drafts = await listDrafts(50);
    patchDraftCard(setState, {
      drafts: Array.isArray(drafts) ? drafts : [],
      visibleDraftCount: 50,
    });
  } catch {
    patchDraftCard(setState, {
      draftsError: 'Не получилось загрузить следующие черновики. Попробуйте ещё раз.',
    });
  } finally {
    patchDraftCard(setState, { draftsLoading: false });
  }
}

function useLinkedinDraftCard() {
  const [state, setState] = useState(initialDraftCardState);
  const safetyStop = useLinkedinActionSafetyStop();
  useInitialDraftData(setState);
  return {
    ...state,
    ...safetyStop,
    setKind: (kind: LinkedinDraft['kind']) => patchDraftCard(setState, { kind }),
    setInputType: (inputType: DraftCardState['inputType']) => patchDraftCard(setState, { inputType }),
    setTone: (tone: DraftCardState['tone']) => patchDraftCard(setState, { tone }),
    setLength: (length: DraftCardState['length']) => patchDraftCard(setState, { length }),
    setTopicText: (topicText: string) => patchDraftCard(setState, { topicText }),
    setSourceText: (sourceText: string) => patchDraftCard(setState, { sourceText }),
    setEditText: (editText: string) => patchDraftCard(setState, { editText }),
    setEditingId: (editingId: string | null) => patchDraftCard(setState, { editingId }),
    setPaywall: (paywall: boolean) => patchDraftCard(setState, { paywall }),
    setPublishDraft: (publishDraft: LinkedinDraft | null) => patchDraftCard(setState, { publishDraft }),
    prepare: (event: FormEvent) => void createDraftFromInput(state, setState, event),
    startTopic: (topic: LinkedinDraftTopic) => void createDraftFromInput(state, setState, null, topic),
    changeStatus: (draft: LinkedinDraft, status: 'copied' | 'rejected' | 'approved') => void updateDraftStatus(state, setState, draft, status),
    saveEdit: (draft: LinkedinDraft) => void saveDraftEdit(state, setState, draft),
    openLinkedin: (draft: LinkedinDraft) => void openApprovedDraft(state, setState, draft),
    markPublished: () => void confirmManualPublication(state, setState),
    dismissTopic: (topic: LinkedinDraftTopic) => void hideTopic(setState, topic),
    showMoreTopics: () => void loadMoreTopics(state, setState),
    showMoreDrafts: () => void loadMoreDrafts(setState),
  };
}

function cadenceCopy(nextAllowedAt: string | null, timezone: string): string {
  const windows = `По будням: 09:00–11:00 или 17:00–19:00 (${timezone}).`;
  if (!nextAllowedAt) return `Не чаще одного поста в 7 дней. ${windows} Публикуете вы сами.`;
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(nextAllowedAt));
  return `Следующая публикация доступна с ${date}. ${windows}`;
}

type LinkedinDraftCardController = ReturnType<typeof useLinkedinDraftCard>;

export function LinkedinDraftCard({ onOpenTariffs, variant = 'compact' }: { readonly onOpenTariffs?: () => void; readonly variant?: 'compact' | 'pipeline' }) {
  const id = useId();
  const controller = useLinkedinDraftCard();
  return <LinkedinDraftCardView id={id} controller={controller} expanded={variant === 'pipeline'} onOpenTariffs={onOpenTariffs} />;
}

function LinkedinDraftCardView({
  id,
  controller,
  expanded,
  onOpenTariffs,
}: {
  readonly id: string;
  readonly controller: LinkedinDraftCardController;
  readonly expanded: boolean;
  readonly onOpenTariffs?: () => void;
}) {
  const busy = controller.draftsLoading || controller.topicsLoading || controller.busy;
  return (
    <section className="career-drafts" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <DraftCardHeader id={id} controller={controller} expanded={expanded} />
      <DraftSafetyMessages controller={controller} />
      <DraftForm id={id} controller={controller} expanded={expanded} />
      <DraftCardMessages controller={controller} />
      {expanded ? (
        <>
          <TopicsSection controller={controller} />
          <DraftsSection controller={controller} />
          <PublishConfirmation controller={controller} />
        </>
      ) : (
        <RecentDrafts drafts={controller.drafts} controller={controller} />
      )}
      <PaywallModal isOpen={controller.paywall} onClose={() => controller.setPaywall(false)} onNavigate={() => onOpenTariffs?.()} />
    </section>
  );
}

function DraftCardHeader({ id, controller, expanded }: { readonly id: string; readonly controller: LinkedinDraftCardController; readonly expanded: boolean }) {
  return (
    <>
      <h2 id={`${id}-title`}>Черновики для LinkedIn</h2>
      <p>Готовим текст — публикуете вы сами</p>
      {expanded ? (
        <>
          <PipelineSummary topics={controller.topicTotal} drafts={controller.drafts} generating={controller.busy} />
          <p className="career-drafts-cadence">{cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}</p>
        </>
      ) : null}
    </>
  );
}

function DraftSafetyMessages({ controller }: { readonly controller: LinkedinDraftCardController }) {
  return (
    <>
      {controller.safetyStatusLoading ? (
        <p className="career-drafts-safety-notice" role="status" aria-busy="true">
          Проверяем статус действий LinkedIn…
        </p>
      ) : null}
      {controller.linkedinSafetyStop?.paused ? (
        <SafetyStopNotice
          reason={controller.linkedinSafetyStop.reason}
          canResume={controller.linkedinSafetyStop.canResume}
          resuming={controller.resumingLinkedin}
          onResume={controller.resumeLinkedinManually}
        />
      ) : null}
      {controller.safetyError ? (
        <p className="career-drafts-safety-error" role="alert">
          {controller.safetyError}
        </p>
      ) : null}
      {controller.safetyNotice ? (
        <p className="career-drafts-safety-notice" role="status">
          {controller.safetyNotice}
        </p>
      ) : null}
    </>
  );
}

function DraftCardMessages({ controller }: { readonly controller: LinkedinDraftCardController }) {
  return (
    <>
      {controller.notice ? (
        <p className="career-drafts-safety-notice" role="status">
          {controller.notice}
        </p>
      ) : null}
      {controller.error ? <p role="alert">{controller.error}</p> : null}
      {controller.draftsError ? <p role="alert">{controller.draftsError}</p> : null}
      {controller.topicsError ? <p role="alert">{controller.topicsError}</p> : null}
    </>
  );
}

function PipelineSummary({ topics, drafts, generating }: { readonly topics: number; readonly drafts: readonly LinkedinDraft[]; readonly generating: boolean }) {
  const count = (status: LinkedinDraftStatus) => drafts.filter((draft) => draft.status === status).length;
  return (
    <div className="career-drafts-recent" aria-label="Сводка конвейера">
      <p>Темы по подтверждённым данным профиля: {topics}</p>
      <p>
        В последних {drafts.length} черновиках: {count('draft')} ждут правки, {count('approved')} одобрено, {count('published')} опубликовано по вашему
        подтверждению.
      </p>
      {generating ? <p role="status">Консультант готовит черновик…</p> : null}
    </div>
  );
}

function ChoiceSelect({
  id,
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="career-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </>
  );
}

function DraftForm({ id, controller, expanded }: { readonly id: string; readonly controller: LinkedinDraftCardController; readonly expanded: boolean }) {
  const inputChoices = [
    { value: 'topic', label: 'Только тему' },
    { value: 'text', label: 'Готовый текст' },
    { value: 'sketch', label: 'Набросок' },
  ];
  const toneChoices = [
    { value: 'business', label: 'Деловой' },
    { value: 'personal', label: 'Личный' },
    { value: 'expert', label: 'Экспертный' },
  ];
  const lengthChoices = [
    { value: 'short', label: 'Короткий' },
    { value: 'medium', label: 'Средний' },
    { value: 'long', label: 'Длинный' },
  ];
  // prettier-ignore
  return <form onSubmit={(event) => controller.prepare(event)}>
    <label htmlFor={`${id}-topic`}>Тема</label>
    <textarea id={`${id}-topic`} aria-label="Тема" value={controller.topicText} onChange={(event) => controller.setTopicText(event.target.value)} maxLength={2000} rows={3} required disabled={controller.busy} placeholder="Тема, мысль или готовый текст. Например: как мы сократили релиз с 14 до 3 дней." />
    {expanded ? <ChoiceSelect id={`${id}-input-type`} label="Что вы даёте" value={controller.inputType} disabled={controller.busy} onChange={(value) => controller.setInputType(value as DraftCardState['inputType'])} choices={inputChoices} /> : null}
    <div className="career-drafts-kinds" role="group" aria-label="Вид черновика">{(['comment', 'post'] as const).map((value) => <ActionButton key={value} label={value === 'comment' ? 'Комментарий' : 'Пост'} pressed={controller.kind === value} disabled={controller.busy} onClick={() => controller.setKind(value)} />)}</div>
    {controller.kind === 'comment' ? <><label htmlFor={`${id}-source`}>Текст поста, на который отвечаете (необязательно)</label><textarea id={`${id}-source`} value={controller.sourceText} onChange={(event) => controller.setSourceText(event.target.value)} maxLength={2000} rows={2} disabled={controller.busy} /></> : null}
    {expanded ? <ChoiceSelect id={`${id}-tone`} label="Тон" value={controller.tone} disabled={controller.busy} onChange={(value) => controller.setTone(value as DraftCardState['tone'])} choices={toneChoices} /> : null}
    {expanded ? <ChoiceSelect id={`${id}-length`} label="Длина" value={controller.length} disabled={controller.busy} onChange={(value) => controller.setLength(value as DraftCardState['length'])} choices={lengthChoices} /> : null}
    <button type="submit" className="career-btn career-btn-secondary" disabled={controller.busy} aria-busy={controller.busy}>{controller.busy ? 'Готовлю…' : 'Подготовить черновик'}</button>
  </form>;
}

function RecentDrafts({ drafts, controller }: { readonly drafts: readonly LinkedinDraft[]; readonly controller: LinkedinDraftCardController }) {
  const latest = drafts[0];
  return latest ? (
    <div className="career-drafts-result">
      <p>{latest.text}</p>
      {latest.status === 'draft' || latest.status === 'copied' ? (
        <div className="career-drafts-kinds">
          {latest.status === 'draft' ? (
            <ActionButton label="Скопировать" disabled={controller.busyDraftId === latest.id} onClick={() => controller.changeStatus(latest, 'copied')} />
          ) : (
            <ActionButton label="Скопировано" disabled />
          )}
          <ActionButton label="Отклонить" disabled={controller.busyDraftId === latest.id} onClick={() => controller.changeStatus(latest, 'rejected')} />
        </div>
      ) : null}
      <ul className="career-drafts-recent" aria-label="Последние черновики">
        {drafts.slice(0, 3).map((draft) => (
          <li key={draft.id}>
            {draft.topic} · <span>{STATUS[draft.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

function ActionButton({
  label,
  disabled,
  pressed,
  onClick,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button className="career-btn career-btn-secondary" type="button" disabled={disabled} aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}

function TopicsSection({ controller }: { readonly controller: LinkedinDraftCardController }) {
  const { topics, topicTotal, topicsLoading, hasMoreTopics } = controller;
  return (
    <section className="career-drafts-result" aria-labelledby="linkedin-topics-title">
      <p id="linkedin-topics-title">
        <strong>Темы от консультанта</strong>
      </p>
      <p>Идеи основаны на подтверждённых фактах профиля и резюме; источник указан у каждой темы.</p>
      {topicsLoading && !topics.length ? (
        <p role="status" aria-busy="true">
          Загружаем темы…
        </p>
      ) : null}
      {!topicsLoading && !topics.length ? <p>Подтверждённых фактов для тем пока нет. Добавьте данные в профиле или предложите свою тему.</p> : null}
      {topics.length ? (
        <ul className="career-drafts-recent" aria-label="Темы от консультанта">
          {topics.map((item) => (
            <TopicRow key={item.id} topic={item} controller={controller} />
          ))}
        </ul>
      ) : null}
      {hasMoreTopics ? <ActionButton label="Показать ещё темы" disabled={topicsLoading} onClick={controller.showMoreTopics} /> : null}
      {topicTotal ? <p>Доступно тем по данным профиля: {topicTotal}.</p> : null}
    </section>
  );
}

function TopicRow({ topic, controller }: { readonly topic: LinkedinDraftTopic; readonly controller: LinkedinDraftCardController }) {
  return (
    <li>
      <strong>{topic.title}</strong> · <span>{topic.source}</span>
      <div className="career-drafts-kinds">
        <ActionButton label="Взять в работу" disabled={controller.busyTopicId === topic.id || controller.busy} onClick={() => controller.startTopic(topic)} />
        <ActionButton label="Скрыть тему" disabled={controller.busyTopicId === topic.id || controller.busy} onClick={() => controller.dismissTopic(topic)} />
      </div>
    </li>
  );
}

function DraftsSection({ controller }: { readonly controller: LinkedinDraftCardController }) {
  const visibleDrafts = controller.drafts.slice(0, controller.visibleDraftCount);
  return (
    <section className="career-drafts-result" aria-labelledby="linkedin-drafts-title">
      <p id="linkedin-drafts-title">
        <strong>Черновики и публикация</strong>
      </p>
      {controller.draftsLoading && !visibleDrafts.length ? (
        <p role="status" aria-busy="true">
          Загружаем черновики…
        </p>
      ) : null}
      {!controller.draftsLoading && !visibleDrafts.length ? <p>Черновиков пока нет. Выберите тему или предложите свою.</p> : null}
      {visibleDrafts.length ? (
        <ul className="career-drafts-recent" aria-label="Черновики и публикация">
          {visibleDrafts.map((draft) => (
            <DraftRow key={draft.id} draft={draft} controller={controller} />
          ))}
        </ul>
      ) : null}
      {visibleDrafts.length ? (
        <p>
          Показаны {visibleDrafts.length} из {controller.drafts.length} загруженных черновиков.
        </p>
      ) : null}
      {controller.drafts.length > controller.visibleDraftCount ? (
        <ActionButton label="Показать ещё черновики" disabled={controller.draftsLoading} onClick={controller.showMoreDrafts} />
      ) : null}
      {!controller.cadence.canPublish && controller.cadence.nextAllowedAt ? (
        <p>{cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}</p>
      ) : null}
    </section>
  );
}

function DraftRow({ draft, controller }: { readonly draft: LinkedinDraft; readonly controller: LinkedinDraftCardController }) {
  const editing = controller.editingId === draft.id;
  return (
    <li>
      <strong>{draft.topic}</strong> · <span>{STATUS[draft.status]}</span>
      {editing ? <DraftEditor draft={draft} controller={controller} /> : <p>{draft.text}</p>}
      {!editing ? <DraftActions draft={draft} controller={controller} /> : null}
    </li>
  );
}

function DraftActions({ draft, controller }: { readonly draft: LinkedinDraft; readonly controller: LinkedinDraftCardController }) {
  const busy = controller.busyDraftId === draft.id;
  const editable = !['published', 'rejected'].includes(draft.status);
  // prettier-ignore
  return <div className="career-drafts-kinds">
    {editable ? <ActionButton label="Править" disabled={busy} onClick={() => { controller.setEditingId(draft.id); controller.setEditText(draft.text); }} /> : null}
    {['draft', 'copied'].includes(draft.status) ? <ActionButton label="Одобрить" disabled={busy} onClick={() => controller.changeStatus(draft, 'approved')} /> : null}
    {editable ? <ActionButton label="Отклонить" disabled={busy} onClick={() => controller.changeStatus(draft, 'rejected')} /> : null}
    {draft.status === 'draft' ? <ActionButton label="Скопировать" disabled={busy} onClick={() => controller.changeStatus(draft, 'copied')} /> : null}
    {draft.status === 'copied' ? <ActionButton label="Скопировано" disabled /> : null}
    {draft.status === 'approved' && controller.cadence.canPublish ? <ActionButton label="Скопировать и открыть LinkedIn" disabled={busy} onClick={() => controller.openLinkedin(draft)} /> : null}
    {draft.status === 'approved' && controller.cadence.canPublish ? <ActionButton label="Отметить опубликованным" disabled={busy} onClick={() => controller.setPublishDraft(draft)} /> : null}
    {busy ? <span role="status">Сохраняем…</span> : null}
    {draft.status === 'approved' && !controller.cadence.canPublish ? <span>{cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}</span> : null}
  </div>;
}

function DraftEditor({ draft, controller }: { readonly draft: LinkedinDraft; readonly controller: LinkedinDraftCardController }) {
  return (
    <div className="career-drafts-result">
      <label htmlFor={`linkedin-draft-edit-${draft.id}`}>Текст черновика</label>
      <textarea
        id={`linkedin-draft-edit-${draft.id}`}
        aria-label="Текст черновика"
        value={controller.editText}
        onChange={(event) => controller.setEditText(event.target.value)}
        maxLength={1300}
        rows={6}
        disabled={controller.busyDraftId === draft.id}
      />
      <div className="career-drafts-kinds">
        <ActionButton
          label="Сохранить правку"
          disabled={controller.busyDraftId === draft.id || !controller.editText.trim()}
          onClick={() => controller.saveEdit(draft)}
        />
        <ActionButton label="Отмена" disabled={controller.busyDraftId === draft.id} onClick={() => controller.setEditingId(null)} />
      </div>
    </div>
  );
}

function useDialogFocus(dialogRef: RefObject<HTMLElement | null>, open: boolean, onCancel: () => void) {
  const cancelRef = useRef(onCancel);
  const previousFocus = useRef<HTMLElement | null>(null);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
    const onKeyDown = (event: KeyboardEvent) => trapDialogKeyboard(event, dialogRef, cancelRef.current);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [dialogRef, open]);
}

function trapDialogKeyboard(event: KeyboardEvent, dialogRef: RefObject<HTMLElement | null>, onCancel: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
  if (!buttons?.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function PublishConfirmation({ controller }: { readonly controller: LinkedinDraftCardController }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, Boolean(controller.publishDraft), () => controller.setPublishDraft(null));
  if (!controller.publishDraft) return null;
  return (
    <div className="career-modal-backdrop">
      <section ref={dialogRef} className="career-modal-card" role="dialog" aria-modal="true" aria-labelledby="linkedin-publish-confirm-title">
        <header className="career-modal-header">
          <h2 id="linkedin-publish-confirm-title">Подтверждение публикации</h2>
        </header>
        <div className="career-modal-body">
          <p>Вы уже опубликовали этот текст в LinkedIn? Платформа не публикует его за вас.</p>
        </div>
        <footer className="career-modal-footer">
          <ActionButton label="Да, отметить" disabled={controller.busyDraftId === controller.publishDraft.id} onClick={controller.markPublished} />
          <ActionButton label="Ещё нет" disabled={controller.busyDraftId === controller.publishDraft.id} onClick={() => controller.setPublishDraft(null)} />
        </footer>
      </section>
    </div>
  );
}

function SafetyStopNotice({
  reason,
  canResume,
  resuming,
  onResume,
}: {
  readonly reason: LinkedinSafetyStopReason | null;
  readonly canResume: boolean;
  readonly resuming: boolean;
  readonly onResume: () => void;
}) {
  return (
    <div className="career-drafts-safety-stop" role="status" aria-busy={resuming}>
      <WarningCircle className="career-drafts-safety-stop__icon" aria-hidden="true" />
      <div className="career-drafts-safety-stop__content">
        <p className="career-drafts-safety-stop__title">
          <strong>Действия LinkedIn приостановлены</strong>
        </p>
        <p>{linkedinStopCopy(reason)}</p>
        {canResume ? (
          <button type="button" className="career-btn career-btn-secondary" disabled={resuming} aria-busy={resuming} onClick={onResume}>
            {resuming ? 'Снимаем паузу…' : 'Возобновить вручную'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
