import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise, CaretDown, ClockCounterClockwise } from '@phosphor-icons/react';
import { CoachApiError } from '../coach/apiClient';
import {
  getProfileHistory,
  revertProfileHistoryEntry,
  type ProfileHistoryActor,
  type ProfileHistoryItem,
} from './profileHistoryApi';
import './profileHistory.css';

const ACTOR_LABEL: Readonly<Record<ProfileHistoryActor, string>> = {
  candidate: 'Вы',
  consultant: 'Консультант',
  import: 'Импорт',
  skill_check: 'Проверка навыков',
};

const SECTION_LABEL: Readonly<Record<string, string>> = {
  headline: 'Заголовок',
  about: 'Обо мне',
  experience: 'Опыт',
  education: 'Образование',
  projects: 'Проекты',
  certifications: 'Сертификаты',
  languages: 'Языки',
  skills: 'Навыки',
  courses: 'Курсы',
  achievements: 'Достижения',
};

const EMPTY_VALUE = '—';
/** The list opens on the five newest changes and grows by five (owner, 02.11). */
export const HISTORY_STEP = 5;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface HistoryState {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  readonly nextPage: number;
  readonly status: 'loading' | 'ready' | 'error';
}

const INITIAL: HistoryState = { entries: [], total: 0, nextPage: 0, status: 'loading' };

function useProfileHistory() {
  const [state, setState] = useState<HistoryState>(INITIAL);
  const load = useCallback(async (page: number, signal?: AbortSignal) => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const result = await getProfileHistory(page, signal);
      setState((current) => ({
        entries: page === 0 ? result.entries : [...current.entries, ...result.entries],
        total: result.total,
        nextPage: page + 1,
        status: 'ready',
      }));
    } catch {
      // The list shows «Повторить»; an aborted load belongs to an unmounted list.
      if (!signal?.aborted) setState((current) => ({ ...current, status: 'error' }));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);
  return { state, load };
}

function useRevertEntry(entryId: string, onReverted: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revert = async () => {
    setBusy(true);
    setError(null);
    try {
      await revertProfileHistoryEntry(entryId);
      onReverted();
    } catch (caught) {
      setError(
        caught instanceof CoachApiError
          ? caught.message
          : 'Не удалось вернуть. Попробуйте ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, revert };
}

/** One side of «было → стало»; an empty side reads «было: —» and is never struck through. */
function ChangeSide({
  tag: Tag,
  side,
  text,
}: {
  readonly tag: 'del' | 'ins';
  readonly side: string;
  readonly text: string;
}) {
  if (!text) {
    return <span className="profile-history__absent">{`${side}: ${EMPTY_VALUE}`}</span>;
  }
  return <Tag aria-label={`${side}: ${text}`}>{text}</Tag>;
}

/** «было → стало»; with no previous value only the new one is shown. */
function ChangeLine({ entry }: { readonly entry: ProfileHistoryItem }) {
  if (!entry.previousText) {
    return <p className="profile-history__change">{entry.appliedText}</p>;
  }
  return (
    <p className="profile-history__change">
      <ChangeSide tag="del" side="было" text={entry.previousText} />
      <span aria-hidden="true"> → </span>
      <ChangeSide tag="ins" side="стало" text={entry.appliedText} />
    </p>
  );
}

/** Changed bullets, collapsed behind «Показать изменения». */
function ChangeDetails({ details }: { readonly details?: readonly string[] }) {
  if (!details?.length) return null;
  return (
    <details className="profile-history__details">
      <summary>Показать изменения</summary>
      <ul>
        {details.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    </details>
  );
}

function HistoryRow({
  entry,
  onReverted,
}: {
  readonly entry: ProfileHistoryItem;
  readonly onReverted: () => void;
}) {
  const { busy, error, revert } = useRevertEntry(entry.id, onReverted);
  const section = SECTION_LABEL[entry.section] ?? entry.section;
  return (
    <li className="profile-history__row" data-testid="profile-history-row">
      <div className="profile-history__meta">
        <span className={`profile-history__actor is-${entry.actor}`}>
          {ACTOR_LABEL[entry.actor]}
        </span>
        <time dateTime={entry.createdAt}>{formatWhen(entry.createdAt)}</time>
        {entry.revertedAt ? <span className="profile-history__reverted">Возвращено</span> : null}
      </div>
      <p className="profile-history__target">
        {section}
        {entry.label ? <span> · {entry.label}</span> : null}
      </p>
      <ChangeLine entry={entry} />
      <ChangeDetails details={entry.details} />
      {error ? (
        <p className="profile-history__error" role="alert">
          {error}
        </p>
      ) : null}
      {entry.revertedAt ? null : (
        <button
          type="button"
          className="career-quiet-button career-btn-sm profile-history__revert"
          disabled={busy}
          onClick={() => void revert()}
        >
          <ArrowCounterClockwise size={16} aria-hidden="true" />
          <span>{busy ? 'Возвращаю…' : 'Вернуть'}</span>
        </button>
      )}
    </li>
  );
}

/** Five more rows per click; the next server page is read once the loaded rows run out. */
function useShownCount(state: HistoryState, load: (page: number) => Promise<void>) {
  const [shown, setShown] = useState(HISTORY_STEP);
  const showMore = () => {
    const next = shown + HISTORY_STEP;
    setShown(next);
    if (next > state.entries.length && state.entries.length < state.total) {
      void load(state.nextPage);
    }
  };
  return { shown, showMore };
}

/**
 * «История изменений»: who changed which profile section, «было → стало»,
 * with «Вернуть». Newest first, five at a time; the server pages by 20.
 * `onChanged` refreshes the profile.
 */
export function ProfileHistoryList({ onChanged }: { readonly onChanged?: () => void }) {
  const { state, load } = useProfileHistory();
  const { shown, showMore } = useShownCount(state, load);
  const reload = () => {
    void load(0);
    onChanged?.();
  };
  if (state.status === 'error' && state.entries.length === 0) {
    return (
      <div className="profile-history__empty" role="alert">
        <p>Не удалось загрузить историю.</p>
        <button type="button" className="career-quiet-button" onClick={() => void load(0)}>
          Повторить
        </button>
      </div>
    );
  }
  if (state.status === 'ready' && state.entries.length === 0) {
    return (
      <div className="profile-history__empty">
        <ClockCounterClockwise size={24} aria-hidden="true" />
        <p>
          Изменений пока нет. Здесь появятся ваши правки, принятые предложения консультанта и
          импорт.
        </p>
      </div>
    );
  }
  return (
    <div className="profile-history" aria-busy={state.status === 'loading'}>
      <ol className="profile-history__list">
        {state.entries.slice(0, shown).map((entry) => (
          <HistoryRow key={entry.id} entry={entry} onReverted={reload} />
        ))}
      </ol>
      {shown < state.total ? (
        <button
          type="button"
          className="career-quiet-button profile-history__more"
          disabled={state.status === 'loading'}
          onClick={showMore}
        >
          {`Показать ещё ${Math.min(HISTORY_STEP, state.total - shown)}`}
        </button>
      ) : null}
    </div>
  );
}

/** Collapsed by default (`career-home-fold`, DESIGN.md); the list is read on first open. */
export function ProfileHistorySection({ onChanged }: { readonly onChanged?: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <section
      id="sec-history"
      className="career-profile-screen-panel career-profile-screen-section profile-history-panel"
      aria-label="История изменений"
    >
      <details
        className="career-home-fold profile-history-fold"
        onToggle={(event) => {
          if (event.currentTarget.open) setOpened(true);
        }}
      >
        <summary className="career-profile-screen-section-head profile-history-fold__summary">
          <h2 id="sec-history-title">История изменений</h2>
          <CaretDown size={16} aria-hidden="true" className="profile-history-fold__caret" />
        </summary>
        {opened ? <ProfileHistoryList onChanged={onChanged} /> : null}
      </details>
    </section>
  );
}
