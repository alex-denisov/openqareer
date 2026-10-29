import {
  useEffect,
  useId,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { PaywallModal } from '../tariffs/PaywallModal';
import { TariffQuotaNote } from '../tariffs/TariffQuotaNote';
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
import {
  PipelineSummary,
  DraftForm,
  RecentDrafts,
  TopicsSection,
  DraftsSection,
  PublishConfirmation,
  SafetyStopNotice,
} from './LinkedinDraftCardParts';

export const STATUS: Record<LinkedinDraftStatus, string> = {
  draft: 'ждёт вашей правки',
  copied: 'скопирован',
  rejected: 'отклонён',
  approved: 'одобрено вами',
  published: 'опубликовано по вашему подтверждению',
};
const GENERATION_ERROR = 'Не получилось подготовить черновик. Попробуйте ещё раз';
export const TOPICS_PAGE_SIZE = 3;
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

export function linkedinStopCopy(reason: LinkedinSafetyStopReason | null): string {
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

export function topicForText(value: string): string {
  const firstLine =
    value
      .trim()
      .split(/[\n.!?]/u, 1)[0]
      ?.trim() ?? '';
  return firstLine.slice(0, 200) || 'Черновик LinkedIn';
}

export type DraftCardState = {
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
    if (active.current)
      patchDraftCard(setState, { draftsError: 'Не получилось загрузить последние черновики.' });
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
    if (active.current)
      patchDraftCard(setState, { topicsError: 'Не получилось загрузить темы по данным профиля.' });
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

async function createDraftFromInput(
  state: DraftCardState,
  setState: DraftCardSetter,
  event: FormEvent | null,
  selectedTopic?: LinkedinDraftTopic,
) {
  event?.preventDefault();
  const value = selectedTopic?.title ?? state.topicText.trim();
  if (!value || state.busy) return;
  patchDraftCard(setState, { busy: true, error: '', notice: '' });
  try {
    const sourceText =
      state.inputType === 'topic'
        ? selectedTopic
          ? undefined
          : state.kind === 'comment'
            ? state.sourceText.trim()
            : undefined
        : value;
    const draft = await createDraft({
      kind: selectedTopic ? 'post' : state.kind,
      topic:
        state.inputType === 'topic' || selectedTopic ? value.slice(0, 200) : topicForText(value),
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
  // B579: исчерпанная квота месяца — текст сервера с тарифом, где её больше, а не окно оплаты.
  if (error instanceof DraftApiError && error.code === 'quota_exhausted')
    patchDraftCard(setState, { error: error.message });
  else if (error instanceof DraftApiError && error.status === 402)
    patchDraftCard(setState, { paywall: true });
  else
    patchDraftCard(setState, {
      error:
        error instanceof DraftApiError && [429, 503].includes(error.status)
          ? error.message
          : GENERATION_ERROR,
    });
}

async function updateDraftStatus(
  state: DraftCardState,
  setState: DraftCardSetter,
  draft: LinkedinDraft,
  status: 'copied' | 'rejected' | 'approved',
) {
  if (state.busyDraftId) return;
  patchDraftCard(setState, { busyDraftId: draft.id, error: '', notice: '' });
  try {
    if (status === 'copied') await navigator.clipboard.writeText(draft.text);
    const updated = await updateDraft(draft.id, { status });
    rememberDraft(setState, updated);
    patchDraftCard(setState, {
      notice:
        status === 'approved'
          ? 'Черновик одобрен. Публикуете вы сами.'
          : status === 'copied'
            ? 'Текст скопирован.'
            : 'Черновик отклонён.',
    });
  } catch {
    patchDraftCard(setState, {
      error:
        status === 'copied'
          ? 'Не получилось скопировать и сохранить статус. Попробуйте ещё раз.'
          : 'Не получилось обновить черновик. Попробуйте ещё раз.',
    });
  } finally {
    patchDraftCard(setState, { busyDraftId: null });
  }
}

async function saveDraftEdit(
  state: DraftCardState,
  setState: DraftCardSetter,
  draft: LinkedinDraft,
) {
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

async function openApprovedDraft(
  state: DraftCardState,
  setState: DraftCardSetter,
  draft: LinkedinDraft,
) {
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
        error instanceof DraftApiError && error.status === 409
          ? error.message
          : 'Не получилось отметить публикацию. Проверьте журнал и повторите попытку.',
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
    setInputType: (inputType: DraftCardState['inputType']) =>
      patchDraftCard(setState, { inputType }),
    setTone: (tone: DraftCardState['tone']) => patchDraftCard(setState, { tone }),
    setLength: (length: DraftCardState['length']) => patchDraftCard(setState, { length }),
    setTopicText: (topicText: string) => patchDraftCard(setState, { topicText }),
    setSourceText: (sourceText: string) => patchDraftCard(setState, { sourceText }),
    setEditText: (editText: string) => patchDraftCard(setState, { editText }),
    setEditingId: (editingId: string | null) => patchDraftCard(setState, { editingId }),
    setPaywall: (paywall: boolean) => patchDraftCard(setState, { paywall }),
    setPublishDraft: (publishDraft: LinkedinDraft | null) =>
      patchDraftCard(setState, { publishDraft }),
    prepare: (event: FormEvent) => void createDraftFromInput(state, setState, event),
    startTopic: (topic: LinkedinDraftTopic) =>
      void createDraftFromInput(state, setState, null, topic),
    changeStatus: (draft: LinkedinDraft, status: 'copied' | 'rejected' | 'approved') =>
      void updateDraftStatus(state, setState, draft, status),
    saveEdit: (draft: LinkedinDraft) => void saveDraftEdit(state, setState, draft),
    openLinkedin: (draft: LinkedinDraft) => void openApprovedDraft(state, setState, draft),
    markPublished: () => void confirmManualPublication(state, setState),
    dismissTopic: (topic: LinkedinDraftTopic) => void hideTopic(setState, topic),
    showMoreTopics: () => void loadMoreTopics(state, setState),
    showMoreDrafts: () => void loadMoreDrafts(setState),
  };
}

export function cadenceCopy(nextAllowedAt: string | null, timezone: string): string {
  const windows = `По будням: 09:00–11:00 или 17:00–19:00 (${timezone}).`;
  if (!nextAllowedAt) return `Не чаще одного поста в 7 дней. ${windows} Публикуете вы сами.`;
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(nextAllowedAt));
  return `Следующая публикация доступна с ${date}. ${windows}`;
}

export type LinkedinDraftCardController = ReturnType<typeof useLinkedinDraftCard>;

export function LinkedinDraftCard({
  onOpenTariffs,
  variant = 'compact',
}: {
  readonly onOpenTariffs?: () => void;
  readonly variant?: 'compact' | 'pipeline';
}) {
  const id = useId();
  const controller = useLinkedinDraftCard();
  return (
    <LinkedinDraftCardView
      id={id}
      controller={controller}
      expanded={variant === 'pipeline'}
      onOpenTariffs={onOpenTariffs}
    />
  );
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
      <TariffQuotaNote quota="linkedin_drafts" refreshKey={controller.drafts.length} />
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
      <PaywallModal
        isOpen={controller.paywall}
        onClose={() => controller.setPaywall(false)}
        onNavigate={() => onOpenTariffs?.()}
      />
    </section>
  );
}

function DraftCardHeader({
  id,
  controller,
  expanded,
}: {
  readonly id: string;
  readonly controller: LinkedinDraftCardController;
  readonly expanded: boolean;
}) {
  return (
    <>
      <h2 id={`${id}-title`}>Черновики для LinkedIn</h2>
      <p>Готовим текст — публикуете вы сами</p>
      {expanded ? (
        <>
          <PipelineSummary
            topics={controller.topicTotal}
            drafts={controller.drafts}
            generating={controller.busy}
          />
          <p className="career-drafts-cadence">
            {cadenceCopy(controller.cadence.nextAllowedAt, controller.cadence.timezone)}
          </p>
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
