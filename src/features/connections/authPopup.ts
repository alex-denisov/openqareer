import {
  invokeDesktopCommand,
  isTauriEnvironment,
} from '../../services/desktop/desktopBridge';
import type { ConnectionResult, ConnectionPlatform } from './connectionResult';
import { openConnectorSession } from './connectorSession';

const POLL_INTERVAL_MS = 1000;

/**
 * Runs the platform's own authorisation page and reports when it is finished.
 *
 * Two shells, two mechanisms: a browser popup can post its result back to the
 * opener, while the desktop shell has no opener relationship — there the window
 * closing is the end of the flow, and the caller refreshes state afterwards.
 */
export function openPlatformAuthPopup(
  platform: ConnectionPlatform,
  url: string,
  onFinish?: (result?: ConnectionResult) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  return isTauriEnvironment()
    ? openDesktopAuthWindow(platform, url, onFinish)
    : openBrowserAuthPopup(url, onFinish);
}

function openDesktopAuthWindow(
  platform: ConnectionPlatform,
  url: string,
  onFinish?: (result?: ConnectionResult) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };

  void openConnectorSession(platform, url).then((result) => {
    if (stopped) return;
    if (!result.opened) {
      onFinish?.();
      return;
    }
    timer = setInterval(() => {
      void invokeDesktopCommand<boolean>('is_connector_session_open', {
        platform,
      })
        .then((stillOpen) => {
          if (stopped || stillOpen) return;
          stop();
          onFinish?.();
        })
        .catch(() => {
          stop();
          onFinish?.();
        });
    }, POLL_INTERVAL_MS);
  });

  return stop;
}

function openBrowserAuthPopup(
  url: string,
  onFinish?: (result?: ConnectionResult) => void,
): () => void {
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
  }, POLL_INTERVAL_MS);

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
