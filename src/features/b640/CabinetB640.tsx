import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { logout, type AuthUser } from '../coach/coachApi';
import { panelViewOf, type PanelView } from './consultant/panelRoute';
import { B640_HOME_PATH, B640_TAB_SETS, matchNode, type B640Match } from './routes';
import { ToastHost } from './kit/Toast';
import { ShellFrame } from './shell/ShellFrame';
import { ShellProvider, useShell } from './shell/ShellContext';
import { useB640Theme, useDocumentTheme } from './theme';

export interface CabinetB640Props {
  readonly session: AuthUser;
  /** Текущий адрес: его ведёт `App`, корень только читает. */
  readonly path: string;
  readonly onNavigate: (path: string) => void;
  readonly onSessionChange: (session: AuthUser | null) => void;
}

/**
 * B649: корень нового кабинета B640. Открывается только аккаунту с флагом
 * `features.cabinetB640`. Всё оформление живёт под классом `.b640` в своём слое
 * каскада и не зависит от прежних стилей кабинета.
 */
export function CabinetB640({ session, path, onNavigate, onSessionChange }: CabinetB640Props) {
  const { theme, setTheme } = useB640Theme();
  // `App` ведёт путь; параметры после `?` читаются из адреса окна, чтобы «Назад»
  // и «Вперёд» браузера между ними тоже перерисовывали экран.
  const pathname = path.split(/[?#]/u)[0];
  const search = useSyncExternalStore(
    subscribeToHistory,
    () => window.location.search,
    () => (path.includes('?') ? `?${path.split('?')[1].split('#')[0]}` : ''),
  );
  const { match, consultantRoute } = useMemo(
    () => resolveAddress(pathname, search),
    [pathname, search],
  );
  const navigate = useCallback(
    (to: string) => {
      onNavigate(to);
      announceAddress();
    },
    [onNavigate],
  );
  const signOut = useCallback(async () => {
    await logout();
    onSessionChange(null);
  }, [onSessionChange]);
  const value = useMemo(
    () => ({
      session,
      path: pathname,
      search,
      match,
      consultantRoute,
      navigate,
      signOut,
      theme,
      setTheme,
    }),
    [session, pathname, search, match, consultantRoute, navigate, signOut, theme, setTheme],
  );
  return (
    <ShellProvider value={value}>
      <CabinetRoot />
    </ShellProvider>
  );
}

interface Address {
  readonly match: B640Match | null;
  readonly consultantRoute: PanelView | null;
}

/**
 * Консультант — панель, а не страница: его адреса открывают панель над «Сегодня»,
 * а рейл, заголовок и страница берутся у «Сегодня».
 */
function resolveAddress(pathname: string, search: string): Address {
  const match = matchNode(pathname);
  if (match?.node.section !== 'consultant') return { match, consultantRoute: null };
  return {
    match: matchNode(B640_HOME_PATH),
    consultantRoute: panelViewOf(match.node.code, search),
  };
}

/**
 * `App` хранит путь без `?…`: переход с `/app/consultant?review=1` на `/app/consultant`
 * путь не меняет и перерисовки не даёт. Свой переход сообщает о новом адресе сам.
 */
const ADDRESS_EVENT = 'b640:address';

function announceAddress(): void {
  window.dispatchEvent(new Event(ADDRESS_EVENT));
}

function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(ADDRESS_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ADDRESS_EVENT, onChange);
  };
}

/** Атрибуты корня повторяют атрибуты `<body>` макета: от них зависят его стили. */
function CabinetRoot() {
  const { match, theme, chrome, panel } = useShell();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useDocumentTheme(root, theme);
  const node = match?.node ?? null;
  // Открытый консультант — это `data-dialog` макета: от него зависят лист на 390 и колонки.
  const rootData = { ...chrome.rootData, ...(panel?.kind === 'consultant' ? { dialog: '1' } : {}) };
  const screenData = Object.fromEntries(
    Object.entries(rootData).map(([name, data]) => [`data-${name}`, data]),
  );
  return (
    <div
      ref={setRoot}
      className="b640"
      data-testid="cabinet-b640"
      data-theme={theme}
      data-active={node?.nav ?? undefined}
      data-template={node?.template ?? 'focus'}
      data-tabs={node?.tabs ? B640_TAB_SETS[node.tabs].label : undefined}
      {...screenData}
    >
      <a className="skip" href="#career-main">
        К содержанию
      </a>
      <ShellFrame />
      <ToastHost />
    </div>
  );
}
