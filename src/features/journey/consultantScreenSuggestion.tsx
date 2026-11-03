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
import { ConsultantTopicProvider } from './consultantScreenTopic';

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
  readonly suppressed: boolean;
  readonly publish: (suggestion: ConsultantScreenSuggestion | null, ownerId: string) => void;
  readonly dismiss: (id: string) => void;
  readonly suppress: (delta: 1 | -1) => void;
  /** Макет 14: пока открыт тренажёр, колонка консультанта на 1440 убрана, вход — значок шапки. */
  readonly trainerOpen: boolean;
  readonly markTrainer: (delta: 1 | -1) => void;
  /** Макет 14 `res`: на итоге тренажёра в шапке 1440 нет значка консультанта. */
  readonly trainerResultOpen: boolean;
  readonly markTrainerResult: (delta: 1 | -1) => void;
}

const NO_STORE: SuggestionStore = {
  suggestion: null,
  dismissed: new Set(),
  suppressed: false,
  publish: () => undefined,
  dismiss: () => undefined,
  suppress: () => undefined,
  trainerOpen: false,
  markTrainer: () => undefined,
  trainerResultOpen: false,
  markTrainerResult: () => undefined,
};

const ConsultantSuggestionContext = createContext<SuggestionStore>(NO_STORE);

/** Сколько смонтированных экранов держат флаг: окно, тренажёр, итог тренажёра. */
function useMountCounter(): readonly [boolean, (delta: 1 | -1) => void] {
  const [count, setCount] = useState(0);
  const mark = useCallback((delta: 1 | -1) => {
    setCount((current) => Math.max(0, current + delta));
  }, []);
  return [count > 0, mark];
}

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
  const [suppressed, suppress] = useMountCounter();
  const [trainerOpen, markTrainer] = useMountCounter();
  const [trainerResultOpen, markTrainerResult] = useMountCounter();
  const value = useMemo(
    () => ({
      suggestion: published?.suggestion ?? null,
      dismissed,
      suppressed,
      publish,
      dismiss,
      suppress,
      trainerOpen,
      markTrainer,
      trainerResultOpen,
      markTrainerResult,
    }),
    [
      published,
      dismissed,
      suppressed,
      publish,
      dismiss,
      suppress,
      trainerOpen,
      markTrainer,
      trainerResultOpen,
      markTrainerResult,
    ],
  );
  return (
    <ConsultantSuggestionContext.Provider value={value}>
      <ConsultantTopicProvider>{children}</ConsultantTopicProvider>
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

/**
 * Пока открыт тренажёр или другое окно поверх экрана, предложение экрана не показываем:
 * «Начать мок-интервью» рядом с уже открытым мок-интервью только путает.
 */
export function useSuppressConsultantSuggestion(active: boolean) {
  const { suppress } = useContext(ConsultantSuggestionContext);
  useEffect(() => {
    if (!active) return undefined;
    suppress(1);
    return () => suppress(-1);
  }, [active, suppress]);
}

/** Тренажёр мок-интервью отмечает себя, пока открыт: оболочка прячет колонку консультанта. */
export function useMarkTrainerScreen(active: boolean) {
  const { markTrainer } = useContext(ConsultantSuggestionContext);
  useEffect(() => {
    if (!active) return undefined;
    markTrainer(1);
    return () => markTrainer(-1);
  }, [active, markTrainer]);
}

export function useTrainerScreenOpen(): boolean {
  return useContext(ConsultantSuggestionContext).trainerOpen;
}

/** Итог тренажёра отмечает себя, пока показан: оболочка убирает значок консультанта из шапки. */
export function useMarkTrainerResult(active: boolean) {
  const { markTrainerResult } = useContext(ConsultantSuggestionContext);
  useEffect(() => {
    if (!active) return undefined;
    markTrainerResult(1);
    return () => markTrainerResult(-1);
  }, [active, markTrainerResult]);
}

export function useTrainerResultOpen(): boolean {
  return useContext(ConsultantSuggestionContext).trainerResultOpen;
}

export function useConsultantScreenSuggestion(stage: CoachTurnStage) {
  const { suggestion, dismissed, suppressed, dismiss } = useContext(ConsultantSuggestionContext);
  const visible =
    suggestion && !suppressed && suggestion.stages.includes(stage) && !dismissed.has(suggestion.id)
      ? suggestion
      : null;
  return { suggestion: visible, dismiss };
}
