import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { logout, type AuthUser } from '../coach/coachApi';
import { B640_TAB_SETS, matchNode } from './routes';
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
  const match = useMemo(() => matchNode(pathname), [pathname]);
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
      navigate: onNavigate,
      signOut,
      theme,
      setTheme,
    }),
    [session, pathname, search, match, onNavigate, signOut, theme, setTheme],
  );
  return (
    <ShellProvider value={value}>
      <CabinetRoot />
    </ShellProvider>
  );
}

function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

/** Атрибуты корня повторяют атрибуты `<body>` макета: от них зависят его стили. */
function CabinetRoot() {
  const { match, theme, chrome } = useShell();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useDocumentTheme(root, theme);
  const node = match?.node ?? null;
  const screenData = Object.fromEntries(
    Object.entries(chrome.rootData ?? {}).map(([name, data]) => [`data-${name}`, data]),
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
