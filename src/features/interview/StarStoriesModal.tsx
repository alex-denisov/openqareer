import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Notebook, Plus, X } from '@phosphor-icons/react';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { useModalAccessibility } from './InterviewPrepModal';
import { createStarStory, getStarStories, updateStarStory } from './starStoriesApi';
import type {
  StarStoriesSnapshot,
  StarStoryView,
  StarStoryWriteInput,
} from '../../../shared/starStories';
import type { ApplicationView } from '../applications/applicationsApi';
import { StarStoryCard } from './StarStoryCard';
import { StarStoryEditor } from './StarStoryEditor';
import './star-stories.css';

export function StarStoriesControl({
  application,
  onOpenExpert,
}: {
  readonly application: ApplicationView;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-star-stories-open"
        onClick={() => setIsOpen(true)}
      >
        <Notebook size={16} aria-hidden="true" /> Открыть STAR-истории
      </button>
      <StarStoriesModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onAskConsultant={
          onOpenExpert
            ? () =>
                onOpenExpert(
                  'interviews',
                  { kind: 'application', id: application.id },
                  `STAR-истории: ${application.vacancy?.title ?? 'отклик'}`,
                )
            : undefined
        }
      />
    </>
  );
}

export function StarStoriesModal({
  isOpen,
  onClose,
  onAskConsultant,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAskConsultant?: () => void;
}) {
  const state = useStarStoriesModalState(isOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeEditor = state.closeEditor;
  const closeModal = useCallback(() => {
    closeEditor();
    onClose();
  }, [closeEditor, onClose]);
  useModalAccessibility(isOpen, closeModal, dialogRef);
  if (!isOpen || typeof document === 'undefined') return null;
  return (
    <StarStoriesDialog
      {...state}
      dialogRef={dialogRef}
      onClose={closeModal}
      onAskConsultant={onAskConsultant}
    />
  );
}

interface StarStoriesModalState {
  snapshot: StarStoriesSnapshot | null;
  loading: boolean;
  loadError?: string;
  editorOpen: boolean;
  editingStory?: StarStoryView;
  saving: boolean;
  saveError?: string;
  saveStory: (input: StarStoryWriteInput) => Promise<boolean>;
  closeEditor: () => void;
  addStory: () => void;
  editStory: (story: StarStoryView) => void;
  retryLoad: () => void;
}

function useStarStoriesModalState(isOpen: boolean): StarStoriesModalState {
  const [snapshot, setSnapshot] = useState<StarStoriesSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<StarStoryView>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  useStarStoriesLoad(isOpen, reloadToken, setSnapshot, setLoading, setLoadError);
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingStory(undefined);
    setSaveError(undefined);
  }, []);
  const saveStory = createStorySaver(
    editingStory,
    setSaving,
    setSaveError,
    setSnapshot,
    setEditorOpen,
  );
  const addStory = useCallback(() => {
    setEditingStory(undefined);
    setSaveError(undefined);
    setEditorOpen(true);
  }, []);
  const editStory = useCallback((story: StarStoryView) => {
    setEditingStory(story);
    setSaveError(undefined);
    setEditorOpen(true);
  }, []);
  const retryLoad = useCallback(() => setReloadToken((current) => current + 1), []);
  return {
    snapshot,
    loading,
    loadError,
    editorOpen,
    editingStory,
    saving,
    saveError,
    saveStory,
    closeEditor,
    addStory,
    editStory,
    retryLoad,
  };
}

function StarStoriesDialog({
  dialogRef,
  onClose,
  onAskConsultant,
  ...state
}: StarStoriesModalState & {
  dialogRef: MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAskConsultant?: () => void;
}) {
  const title = getModalTitle(state.editorOpen, state.editingStory);
  const portalRoot = document.querySelector<HTMLElement>('.career-shell') ?? document.body;
  return typeof document === 'undefined'
    ? null
    : createPortal(
        <StarStoriesPortal
          {...state}
          title={title}
          dialogRef={dialogRef}
          onClose={onClose}
          onAskConsultant={onAskConsultant}
        />,
        portalRoot,
      );
}

function StarStoriesPortal({
  dialogRef,
  onClose,
  onAskConsultant,
  title,
  ...state
}: StarStoriesModalState & {
  title: string;
  dialogRef: MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  onAskConsultant?: () => void;
}) {
  const askConsultant = () => {
    onClose();
    onAskConsultant?.();
  };
  return (
    <div
      className="career-interview-backdrop"
      role="presentation"
      onMouseDown={closeOnBackdrop(dialogRef, onClose)}
    >
      <div
        className="career-interview-modal career-star-stories-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="career-star-stories-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <StarStoriesHeader
          title={title}
          editorOpen={state.editorOpen}
          onBack={state.closeEditor}
          onClose={onClose}
        />
        <div className="career-interview-body career-star-stories-body">
          <StarStoriesPortalContent
            state={state}
            onAskConsultant={onAskConsultant ? askConsultant : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function StarStoriesPortalContent({
  state,
  onAskConsultant,
}: {
  state: StarStoriesModalState;
  onAskConsultant?: () => void;
}) {
  if (state.editorOpen) return <StarStoriesEditorView state={state} />;
  return (
    <StarStoriesContent
      snapshot={state.snapshot}
      loading={state.loading}
      error={state.loadError}
      onRetry={state.retryLoad}
      onAdd={state.addStory}
      onEdit={state.editStory}
      onAskConsultant={onAskConsultant}
    />
  );
}

function StarStoriesEditorView({ state }: { state: StarStoriesModalState }) {
  return (
    <StarStoryEditor
      story={state.editingStory}
      facts={state.snapshot?.facts ?? []}
      saving={state.saving}
      error={state.saveError}
      onCancel={state.closeEditor}
      onSave={state.saveStory}
    />
  );
}

function getModalTitle(editorOpen: boolean, story?: StarStoryView): string {
  if (!editorOpen) return 'STAR-истории';
  return story ? 'Править STAR-историю' : 'Новая STAR-история';
}

function useStarStoriesLoad(
  isOpen: boolean,
  reloadToken: number,
  setSnapshot: (value: StarStoriesSnapshot | null) => void,
  setLoading: (value: boolean) => void,
  setError: (value: string | undefined) => void,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void getStarStories(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(apiErrorMessage(reason, 'Не удалось загрузить STAR-истории.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isOpen, reloadToken, setError, setLoading, setSnapshot]);
}

function createStorySaver(
  editingStory: StarStoryView | undefined,
  setSaving: (value: boolean) => void,
  setError: (value: string | undefined) => void,
  setSnapshot: (
    update: (current: StarStoriesSnapshot | null) => StarStoriesSnapshot | null,
  ) => void,
  setEditorOpen: (value: boolean) => void,
) {
  return async (input: StarStoryWriteInput): Promise<boolean> => {
    setSaving(true);
    setError(undefined);
    try {
      const saved = editingStory
        ? await updateStarStory(editingStory.id, editingStory.version, input)
        : await createStarStory(input);
      setSnapshot((current) => upsertStory(current, saved));
      setEditorOpen(false);
      return true;
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить STAR-историю.'));
      return false;
    } finally {
      setSaving(false);
    }
  };
}

function upsertStory(
  current: StarStoriesSnapshot | null,
  saved: StarStoryView,
): StarStoriesSnapshot | null {
  if (!current) return current;
  const exists = current.stories.some((story) => story.id === saved.id);
  const stories = exists
    ? current.stories.map((story) => (story.id === saved.id ? saved : story))
    : [saved, ...current.stories];
  return { ...current, stories };
}

function closeOnBackdrop(ref: MutableRefObject<HTMLDivElement | null>, onClose: () => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (!ref.current?.contains(event.target as Node)) onClose();
  };
}

function StarStoriesHeader({
  title,
  editorOpen,
  onBack,
  onClose,
}: {
  title: string;
  editorOpen: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <header className="career-interview-header career-star-stories-header">
      {editorOpen ? (
        <button
          type="button"
          className="career-star-stories-back"
          aria-label="Назад к STAR-историям"
          onClick={onBack}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
      ) : (
        <span className="career-star-stories-heading-icon">
          <Notebook size={20} aria-hidden="true" />
        </span>
      )}
      <h2 id="career-star-stories-title" className="career-interview-title">
        {title}
      </h2>
      <button
        type="button"
        className="career-interview-close-btn"
        onClick={onClose}
        aria-label="Закрыть STAR-истории"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function StarStoriesContent({
  snapshot,
  loading,
  error,
  onRetry,
  onAdd,
  onEdit,
  onAskConsultant,
}: {
  snapshot: StarStoriesSnapshot | null;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (story: StarStoryView) => void;
  onAskConsultant?: () => void;
}) {
  if (loading)
    return (
      <p className="career-star-stories-loading" role="status">
        Загружаем истории…
      </p>
    );
  if (error) return <StoriesLoadError message={error} onRetry={onRetry} />;
  if (!snapshot) return <StoriesLoadError message="Данные историй недоступны." onRetry={onRetry} />;
  return snapshot.stories.length === 0 ? (
    <EmptyStarStories onAdd={onAdd} onAskConsultant={onAskConsultant} />
  ) : (
    <StarStoriesList stories={snapshot.stories} onAdd={onAdd} onEdit={onEdit} />
  );
}

function StoriesLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="career-star-stories-error" role="alert">
      <p>{message}</p>
      <button type="button" className="career-btn career-btn-secondary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

function EmptyStarStories({
  onAdd,
  onAskConsultant,
}: {
  onAdd: () => void;
  onAskConsultant?: () => void;
}) {
  return (
    <section className="career-star-stories-empty">
      <Notebook size={28} aria-hidden="true" />
      <h3>Нет STAR-историй</h3>
      <p>
        Соберите ситуацию, задачу, действия и результат. Истории без факта профиля останутся
        неподтверждёнными.
      </p>
      {onAskConsultant ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onAskConsultant}>
          Собрать с консультантом
        </button>
      ) : null}
      <button type="button" className="career-btn career-btn-primary" onClick={onAdd}>
        <Plus size={16} aria-hidden="true" /> Добавить историю
      </button>
    </section>
  );
}

function StarStoriesList({
  stories,
  onAdd,
  onEdit,
}: {
  stories: readonly StarStoryView[];
  onAdd: () => void;
  onEdit: (story: StarStoryView) => void;
}) {
  return (
    <div className="career-star-stories-list">
      <p className="career-star-stories-lead">
        Числа в результате сверяются с выбранными фактами профиля.
      </p>
      <button
        type="button"
        className="career-btn career-btn-primary career-star-story-add"
        onClick={onAdd}
      >
        <Plus size={16} aria-hidden="true" /> Добавить историю
      </button>
      {stories.map((story) => (
        <StarStoryCard key={story.id} story={story} onEdit={() => onEdit(story)} />
      ))}
    </div>
  );
}
