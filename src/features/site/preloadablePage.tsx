import { createElement, lazy, type ComponentType } from 'react';

type PageModule<P> = { readonly default: ComponentType<P> };

export interface PreloadablePage<P> {
  /** Renders the page directly once loaded, through React.lazy before that. */
  readonly Page: ComponentType<P>;
  /** Loads the module; repeated calls share one request. */
  readonly preload: () => Promise<void>;
}

/**
 * B577: `createRoot` over a prerendered public page committed the empty
 * Suspense fallback while the page chunk loaded, so the whole page vanished
 * and was drawn again. A page preloaded before the mount renders directly:
 * React's first commit already is the page, never an empty root.
 */
export function preloadablePage<P extends object>(
  load: () => Promise<PageModule<P>>,
): PreloadablePage<P> {
  let ready: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const loadOnce = () =>
    (pending ??= load().then((module) => {
      ready = module.default;
      return module.default;
    }));
  const Lazy = lazy(() => loadOnce().then((component) => ({ default: component })));
  function Page(props: P) {
    return createElement((ready ?? Lazy) as ComponentType<P>, props);
  }
  return { Page, preload: () => loadOnce().then(() => undefined) };
}
