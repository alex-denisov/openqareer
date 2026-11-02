import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CoachTurnStage } from '../coach/coachApi';

/**
 * Предложение консультанта по текущему экрану (макеты 5 и 9): экран сам строит его
 * из своих данных и публикует, панель показывает вместо общих вопросов-подсказок.
 */
export interface ConsultantScreenSuggestion {
  /** Ключ для «Не сейчас»: одно и то же предложение не возвращается до перезагрузки. */
  readonly id: string;
  readonly stages: readonly CoachTurnStage[];
  readonly title: string;
  readonly detail: string;
  readonly acceptLabel: string;
  readonly dismissLabel: string;
  readonly onAccept: () => void;
}

interface SuggestionStore {
  readonly suggestion: ConsultantScreenSuggestion | null;
  readonly dismissed: ReadonlySet<string>;
  readonly publish: (suggestion: ConsultantScreenSuggestion | null, ownerId: string) => void;
  readonly dismiss: (id: string) => void;
}

const NO_STORE: SuggestionStore = {
  suggestion: null,
  dismissed: new Set(),
  publish: () => undefined,
  dismiss: () => undefined,
};

const ConsultantSuggestionContext = createContext<SuggestionStore>(NO_STORE);

export function ConsultantSuggestionProvider({ children }: { readonly children: ReactNode }) {
  const [published, setPublished] = useState<{
    readonly ownerId: string;
    readonly suggestion: ConsultantScreenSuggestion;
  } | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const publish = useCallback((suggestion: ConsultantScreenSuggestion | null, ownerId: string) => {
    setPublished((current) => {
      if (suggestion) return { ownerId, suggestion };
      return current?.ownerId === ownerId ? null : current;
    });
  }, []);
  const dismiss = useCallback((id: string) => {
    setDismissed((current) => new Set([...current, id]));
  }, []);
  const value = useMemo(
    () => ({ suggestion: published?.suggestion ?? null, dismissed, publish, dismiss }),
    [published, dismissed, publish, dismiss],
  );
  return (
    <ConsultantSuggestionContext.Provider value={value}>
      {children}
    </ConsultantSuggestionContext.Provider>
  );
}

let nextOwnerId = 0;

/** Экран публикует предложение, пока смонтирован; `null` — честное «предложить нечего». */
export function usePublishConsultantSuggestion(suggestion: ConsultantScreenSuggestion | null) {
  const { publish } = useContext(ConsultantSuggestionContext);
  const ownerId = useRef('');
  if (!ownerId.current) ownerId.current = `screen-${(nextOwnerId += 1)}`;
  const latestAccept = useRef(suggestion?.onAccept);
  latestAccept.current = suggestion?.onAccept;
  const signature = suggestion
    ? [suggestion.id, suggestion.title, suggestion.detail, suggestion.stages.join(',')].join(
        '\u0000',
      )
    : '';
  const stable = useMemo(
    () => (suggestion ? { ...suggestion, onAccept: () => latestAccept.current?.() } : null),
    // Подпись меняется вместе со смыслом предложения; обработчик берётся из ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  useEffect(() => {
    const owner = ownerId.current;
    publish(stable, owner);
    return () => publish(null, owner);
  }, [publish, stable]);
}

export function useConsultantScreenSuggestion(stage: CoachTurnStage) {
  const { suggestion, dismissed, dismiss } = useContext(ConsultantSuggestionContext);
  const visible =
    suggestion && suggestion.stages.includes(stage) && !dismissed.has(suggestion.id)
      ? suggestion
      : null;
  return { suggestion: visible, dismiss };
}
