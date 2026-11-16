import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '../../coach/coachApi';
import { panelPath, type PanelView } from '../consultant/panelRoute';
import { B640_HOME_PATH, type B640Match } from '../routes';
import type { B640ThemeState } from '../theme';

/** Что экран раздела может поменять в оболочке вокруг себя. */
export interface ScreenChrome {
  /** Заголовок в верхней полосе вместо заголовка узла. */
  readonly title?: string;
  /** Подпись последнего звена пути: имя вакансии, компании, цели. */
  readonly crumb?: string;
  /** Число новых уведомлений у колокольчика, если экран знает его точнее оболочки. */
  readonly bellCount?: number;
  /** Среди новых уведомлений есть важное. */
  readonly bellCritical?: boolean;
  /** У консультанта есть предложение (точка на кнопке в шапке 390). */
  readonly coachDot?: boolean;
  /** На экране есть шапка контекста: в пути остаются первое звено и она. */
  readonly hasContextHead?: boolean;
  /** Атрибуты корня, от которых зависят стили макета: `data-mtight`, `data-main-right`. */
  readonly rootData?: Readonly<Record<string, string>>;
}

/** Панель поверх раздела: консультант (третья колонка, на 390 — лист) или уведомления. */
export type ShellPanel =
  | { readonly kind: 'consultant'; readonly view: PanelView }
  | { readonly kind: 'notifications' };

export interface ShellContextValue extends B640ThemeState {
  readonly session: AuthUser;
  /** Текущий адрес без домена и без параметров после `?`. */
  readonly path: string;
  /** Параметры адреса после `?`, вместе со знаком; пусто, если их нет. */
  readonly search: string;
  /** Узел карты по адресу; `null` — адрес не из карты. У адресов консультанта — «Сегодня». */
  readonly match: B640Match | null;
  /** Адрес сам открывает панель консультанта (`/app/consultant…`): её вид; иначе `null`. */
  readonly consultantRoute: PanelView | null;
  /** Открытая панель поверх раздела; `null` — панели нет. */
  readonly panel: ShellPanel | null;
  /** Открыть консультанта над текущим разделом или сменить вид открытой панели. */
  readonly openConsultant: (view?: PanelView) => void;
  readonly openNotifications: () => void;
  /** Закрыть панель: раздел под ней остаётся на месте. */
  readonly closePanel: () => void;
  readonly navigate: (path: string) => void;
  /** Выход из аккаунта. При сбое бросает ошибку: покажите её на месте действия. */
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
  | 'chrome'
  | 'setChromeEntry'
  | 'ctxSlot'
  | 'setCtxSlot'
  | 'panel'
  | 'openConsultant'
  | 'openNotifications'
  | 'closePanel'
>;

type PanelControls = Pick<
  ShellContextValue,
  'panel' | 'openConsultant' | 'openNotifications' | 'closePanel'
>;

const DIALOG: PanelView = { kind: 'dialog' };

/**
 * Панель поверх раздела. Консультант переживает переход между разделами (тема идёт за
 * разделом), уведомления закрываются при переходе. На адресах консультанта панель ведёт адрес.
 */
function usePanel(value: ShellBase): PanelControls {
  const { path, consultantRoute, navigate } = value;
  const [state, setState] = useState<{ path: string; panel: ShellPanel | null }>({
    path,
    panel: null,
  });
  const kept = state.panel?.kind === 'notifications' && state.path !== path ? null : state.panel;
  const panel: ShellPanel | null = consultantRoute
    ? { kind: 'consultant', view: consultantRoute }
    : kept;
  const routed = consultantRoute !== null;
  const openConsultant = useCallback(
    (view: PanelView = DIALOG) => {
      if (routed) navigate(panelPath(view));
      else setState({ path, panel: { kind: 'consultant', view } });
    },
    [routed, navigate, path],
  );
  const openNotifications = useCallback(
    () => setState({ path, panel: { kind: 'notifications' } }),
    [path],
  );
  const closePanel = useCallback(() => {
    setState({ path, panel: null });
    if (routed) navigate(B640_HOME_PATH);
  }, [routed, navigate, path]);
  return useMemo(
    () => ({ panel, openConsultant, openNotifications, closePanel }),
    // Вид панели сравнивается по содержимому: объект из адреса собирается заново.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(panel), openConsultant, openNotifications, closePanel],
  );
}

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
  const panels = usePanel(value);
  const context = useMemo(
    () => ({ ...value, ...panels, chrome, setChromeEntry, ctxSlot, setCtxSlot }),
    [value, panels, chrome, setChromeEntry, ctxSlot],
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
  // До отрисовки: заголовок и путь не мигают значениями по умолчанию.
  useLayoutEffect(() => {
    setChromeEntry(id, JSON.parse(key) as ScreenChrome);
    return () => setChromeEntry(id, null);
  }, [id, key, setChromeEntry]);
}
