import type { SessionLayout } from './connectorSession';

export const MIN_SESSION_SIZE = { width: 320, height: 320 } as const;

/**
 * The native session webview is a child of the app window, so its layout is
 * viewport-relative CSS pixels. A host rect measured after a page scroll, a
 * transform, or a small viewport can push that layout outside the frame the
 * candidate sees (owner report, B156): the login page then floats over nothing
 * or hangs past the app edge. Every value is therefore clamped back inside the
 * current viewport, and sizes below the native minimum are lifted to it.
 */
export function sessionLayoutForHost(
  host: HTMLElement | null,
  viewportWidth: number,
  viewportHeight: number,
): SessionLayout | undefined {
  if (!host) return undefined;
  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const width = Math.min(
    Math.max(rect.width, MIN_SESSION_SIZE.width),
    viewportWidth,
  );
  const height = Math.min(
    Math.max(rect.height, MIN_SESSION_SIZE.height),
    viewportHeight,
  );
  const x = clamp(rect.x, 0, Math.max(0, viewportWidth - width));
  const y = clamp(rect.y, 0, Math.max(0, viewportHeight - height));
  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Keeps the native webview glued to its host. Resize alone was never enough:
 * the wizard page scrolls while the sign-in window stays put, which is exactly
 * the drift the owner saw. Scroll events do not bubble, so capture is required.
 */
export function watchConnectorHost(
  platform: 'hh' | 'linkedin',
  host: HTMLElement,
  onLayout: (layout: SessionLayout) => void,
): () => void {
  const update = () => {
    const layout = sessionLayoutForHost(host, window.innerWidth, window.innerHeight);
    if (layout) onLayout(layout);
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(host);
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', update);
    window.removeEventListener('scroll', update, true);
    void platform;
  };
}
