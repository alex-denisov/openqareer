import type { ConnectionResult } from './connectionResult';

// eslint-disable-next-line max-lines-per-function
export function openPlatformAuthPopup(
  url: string,
  onFinish?: (result?: ConnectionResult) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const width = 560;
  const height = 680;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2),
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2),
  );

  const popup = window.open(
    url,
    'OpenQareerAuthPopup',
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`,
  );

  let cleanedUp = false;

  const handleMessage = (event: MessageEvent) => {
    if (
      event.data &&
      typeof event.data === 'object' &&
      event.data.type === 'openqareer_oauth_complete'
    ) {
      cleanup();
      onFinish?.(event.data.result as ConnectionResult);
    }
  };

  window.addEventListener('message', handleMessage);

  const timer = setInterval(() => {
    if (!popup || popup.closed) {
      cleanup();
      onFinish?.();
    }
  }, 1000);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(timer);
    window.removeEventListener('message', handleMessage);
  }

  return () => {
    cleanup();
    if (popup && !popup.closed) {
      popup.close();
    }
  };
}
