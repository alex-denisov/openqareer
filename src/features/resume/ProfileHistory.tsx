import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise, ClockCounterClockwise } from '@phosphor-icons/react';
import { CoachApiError } from '../coach/apiClient';
import { SectionHead } from './ProfileSectionHead';
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
};

const EMPTY_VALUE = 'пусто';

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
      <p className="profile-history__change">
        <del aria-label={`было: ${entry.previousText || EMPTY_VALUE}`}>
          {entry.previousText || EMPTY_VALUE}
        </del>
        <span aria-hidden="true"> → </span>
        <ins aria-label={`стало: ${entry.appliedText || EMPTY_VALUE}`}>
          {entry.appliedText || EMPTY_VALUE}
        </ins>
      </p>
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

/**
 * «История изменений»: who changed which profile section, «было → стало»,
 * with «Вернуть». Pages of 20, newest first. `onChanged` refreshes the profile.
 */
export function ProfileHistoryList({ onChanged }: { readonly onChanged?: () => void }) {
  const { state, load } = useProfileHistory();
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
        {state.entries.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} onReverted={reload} />
        ))}
      </ol>
      {state.entries.length < state.total ? (
        <button
          type="button"
          className="career-quiet-button profile-history__more"
          disabled={state.status === 'loading'}
          onClick={() => void load(state.nextPage)}
        >
          Показать ещё
        </button>
      ) : null}
    </div>
  );
}

export function ProfileHistorySection({ onChanged }: { readonly onChanged?: () => void }) {
  return (
    <section
      id="sec-history"
      className="career-profile-screen-panel career-profile-screen-section profile-history-panel"
      aria-labelledby="sec-history-title"
    >
      <SectionHead id="sec-history-title" title="История изменений" />
      <ProfileHistoryList onChanged={onChanged} />
    </section>
  );
}
