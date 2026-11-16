import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '../../coach/coachApi';
import type { B640Match } from '../routes';
import type { B640ThemeState } from '../theme';

/** Что экран раздела может поменять в оболочке вокруг себя. */
export interface ScreenChrome {
  /** Заголовок в верхней полосе вместо заголовка узла. */
  readonly title?: string;
  /** Подпись последнего звена пути: имя вакансии, компании, цели. */
  readonly crumb?: string;
  /** Число новых уведомлений у колокольчика. */
  readonly bellCount?: number;
  /** Среди новых уведомлений есть важное. */
  readonly bellCritical?: boolean;
  /** У консультанта есть предложение (точка на кнопке в шапке 390). */
  readonly coachDot?: boolean;
  /** На экране открыта панель консультанта: у сетки появляется третья колонка. */
  readonly hasPanel?: boolean;
  /** На экране есть шапка контекста: в пути остаются первое звено и она. */
  readonly hasContextHead?: boolean;
  /** Атрибуты корня, от которых зависят стили макета: `data-mtight`, `data-main-right`. */
  readonly rootData?: Readonly<Record<string, string>>;
}

export interface ShellContextValue extends B640ThemeState {
  readonly session: AuthUser;
  /** Текущий адрес без домена. */
  readonly path: string;
  /** Узел карты по адресу; `null` — адрес не из карты. */
  readonly match: B640Match | null;
  readonly navigate: (path: string) => void;
  readonly signOut: () => Promise<void>;
  readonly chrome: ScreenChrome;
  readonly setChromeEntry: (id: string, chrome: ScreenChrome | null) => void;
  /** Место в пути на 1440 и 1176, куда встаёт шапка контекста. */
  readonly ctxSlot: HTMLElement | null;
  readonly setCtxSlot: (slot: HTMLElement | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const EMPTY_ENTRIES: Readonly<Record<string, ScreenChrome>> = {};

type ShellBase = Omit<
  ShellContextValue,
  'chrome' | 'setChromeEntry' | 'ctxSlot' | 'setCtxSlot'
>;

export function ShellProvider({
  value,
  children,
}: {
  readonly value: ShellBase;
  readonly children: ReactNode;
}) {
  const path = value.path;
  const [state, setState] = useState<{
    path: string;
    entries: Readonly<Record<string, ScreenChrome>>;
  }>({ path, entries: EMPTY_ENTRIES });
  const [ctxSlot, setCtxSlot] = useState<HTMLElement | null>(null);
  // Настройки прошлого экрана не переходят на новый адрес.
  const entries = state.path === path ? state.entries : EMPTY_ENTRIES;
  const setChromeEntry = useCallback(
    (id: string, chrome: ScreenChrome | null) =>
      setState((previous) => {
        const base = previous.path === path ? previous.entries : EMPTY_ENTRIES;
        const { [id]: _removed, ...rest } = base;
        return { path, entries: chrome ? { ...rest, [id]: chrome } : rest };
      }),
    [path],
  );
  const chrome = useMemo<ScreenChrome>(
    () => Object.assign({}, ...Object.values(entries)) as ScreenChrome,
    [entries],
  );
  const context = useMemo(
    () => ({ ...value, chrome, setChromeEntry, ctxSlot, setCtxSlot }),
    [value, chrome, setChromeEntry, ctxSlot],
  );
  return <ShellContext.Provider value={context}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('B640: useShell вызван вне корня нового кабинета');
  return context;
}

/**
 * Экран раздела сообщает оболочке свой заголовок, подпись звена пути и атрибуты
 * корня. Несколько вызовов на одном экране складываются; значения сравниваются
 * по содержимому, объект можно собирать на месте.
 */
export function useScreenChrome(chrome: ScreenChrome): void {
  const { setChromeEntry } = useShell();
  const id = useId();
  const key = JSON.stringify(chrome);
  useEffect(() => {
    setChromeEntry(id, JSON.parse(key) as ScreenChrome);
    return () => setChromeEntry(id, null);
  }, [id, key, setChromeEntry]);
}
