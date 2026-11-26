import { Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ScreenActive } from '../kit/screenActive';
import { ShellContext, useShell } from './ShellContext';

const noop = () => undefined;

/** Закрытый список видит оболочку такой, какой она была, и ничего в ней не меняет. */
function FrozenShell({ active, children }: { readonly active: boolean; readonly children: ReactNode }) {
  const shell = useShell();
  const [last, setLast] = useState(shell);
  if (active && last !== shell) setLast(shell);
  const value = useMemo(
    () =>
      active
        ? shell
        : { ...last, navigate: noop, setChromeEntry: noop, setCtxSlot: noop, ctxSlot: null },
    [active, shell, last],
  );
  return (
    <ScreenActive.Provider value={active}>
      <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
    </ScreenActive.Provider>
  );
}

const LOADING = <div className="page b640-loading" aria-busy="true" />;

/**
 * Экран-список, который остаётся смонтированным под объектом (B798): фильтры, порции и
 * раскрытая строка на месте при возврате. Закрытый список вынут из документа.
 */
export function KeptScreen({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement('div');
    element.className = 'kept';
    setHost(element);
    return () => element.remove();
  }, []);
  useLayoutEffect(() => {
    if (active && host) slot.current?.appendChild(host);
  }, [active, host]);
  return (
    <>
      {active ? <div className="kept-slot" ref={slot}>{host ? null : LOADING}</div> : null}
      {host
        ? createPortal(
            <FrozenShell active={active}>
              <Suspense fallback={LOADING}>{children}</Suspense>
            </FrozenShell>,
            host,
          )
        : null}
    </>
  );
}
