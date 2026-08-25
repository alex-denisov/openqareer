import { useEffect, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { isTauriEnvironment, probeNetworkStatus } from '../../services/desktop/desktopBridge';
import { setStoredSessionToken } from '../coach/apiClient';
import type { ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import {
  closeConnectorSession,
  inspectSessionPage,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  resetConnectorSession,
  resizeConnectorSession,
  sessionCheckFailure,
  type ConnectorSessionStep,
  type RouteNotice,
} from './connectorSession';
import {
  nextAnimationFrame,
  startConnectorSession,
} from './connectorSessionStart';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';
import { sessionUnreadableNotice } from './sessionWaitingStage';
import {
  createLinkedInSessionImportFlow,
  linkedinWaitingNotice,
  type LinkedInSessionImportFlow,
  type LinkedInSessionPollResult,
  type LinkedInWaitingNotice,
} from './linkedinSessionPoll';
import {
  ProtectedRouteError,
  protectedRouteFailureMessage,
  startLinkedInProtectedRoute,
} from './linkedinProtectedRoute';

const SESSION_POLL_INTERVAL_MS = 750;
const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';

export interface LinkedInConnectModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onImportSuccess: (
    parsed: ParsedResume,
    rawUrl: string,
  ) => void | Promise<void>;
  readonly onConnectionFailure: (message: string) => void;
}

// One component owns one provider-session state machine.
// eslint-disable-next-line max-lines-per-function
export function LinkedInConnectModal({
  isOpen,
  onClose,
  onImportSuccess,
  onConnectionFailure,
}: LinkedInConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const [error, setError] = useState<string>();
  const [probe, setProbe] = useState<{ accessible: boolean }>();
  const [tunnelActive, setTunnelActive] = useState(false);
  const [routeStarting, setRouteStarting] = useState(false);
  const [autoPollPaused, setAutoPollPaused] = useState(false);
  const [waiting, setWaiting] = useState<LinkedInWaitingNotice>();
  const webviewHost = useRef<HTMLDivElement>(null);
  const sessionFlow = useRef<LinkedInSessionImportFlow>();
  /** The page itself proved the candidate is signed in. */
  const signedIn = useRef(false);
  /** Consecutive polls on a loaded, unchallenged page with no signed-in marker. */
  const unrecognisedPolls = useRef(0);
  /** Consecutive polls that could not read the page at all. */
  const unreadablePolls = useRef(0);

  function closeModal() {
    sessionFlow.current = undefined;
    void closeConnectorSession('linkedin');
    onClose();
  }

  useEffect(
    () => () => {
      void closeConnectorSession('linkedin');
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !isTauriEnvironment() || step === 'idle') return;
    const host = webviewHost.current;
    if (!host) return;
    return watchConnectorHost('linkedin', host, (layout) => {
      void resizeConnectorSession('linkedin', layout);
    });
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbe(undefined);
    setTunnelActive(false);
    setRouteStarting(false);
    setAutoPollPaused(false);
    setWaiting(undefined);
    signedIn.current = false;
    unrecognisedPolls.current = 0;
    unreadablePolls.current = 0;
    sessionFlow.current = undefined;
    void probeNetworkStatus()
      .then((status) => setProbe(status.linkedin))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  /**
   * The route comes up first, then the window, and only then the step that
   * turns the session poll on. Announcing `session_open` earlier made the very
   * first poll inspect a window that did not exist yet, and the candidate was
   * told the import had failed before they had typed anything (B157).
   */
  async function startSession() {
    setError(undefined);
    setWaiting(undefined);
    unrecognisedPolls.current = 0;
    unreadablePolls.current = 0;
    setStep('opening');
    if (isTauriEnvironment()) {
      setRouteStarting(true);
      try {
        const route = await startLinkedInProtectedRoute();
        setProbe(route.probe);
        setTunnelActive(route.tunnelActive);
      } catch (reason) {
        setRouteStarting(false);
        if (reason instanceof ProtectedRouteError && reason.code === 'session_expired') {
          setStoredSessionToken(null);
          closeModal();
          window.history.pushState(null, '', '/login');
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        setStep('idle');
        setError(protectedRouteFailureMessage(reason));
        return;
      }
      setRouteStarting(false);
    }
    const started = await startConnectorSession({
      platform: 'linkedin',
      url: LINKEDIN_LOGIN_URL,
      measureLayout: () =>
        sessionLayoutForHost(webviewHost.current, window.innerWidth, window.innerHeight),
      waitForFrame: nextAnimationFrame,
      onStep: setStep,
      openSession: openConnectorSession,
    });
    if (!started.opened) setError(started.error);
  }

  function getSessionFlow(): LinkedInSessionImportFlow {
    if (sessionFlow.current) return sessionFlow.current;
    sessionFlow.current = createLinkedInSessionImportFlow({
      inspectCurrentPage: () => inspectSessionPage('linkedin'),
      readSessionPage: (url) => readSessionPage('linkedin', url),
      onAuthenticated: () => {
        // The sign-in window stays on screen while the profile is read: a
        // hidden WKWebView stops running the script that read depends on, so
        // parking it here failed every capture that followed a good sign-in,
        // and the step then reported the import as failed (B157).
        signedIn.current = true;
        setWaiting({ text: 'Вход выполнен — читаем ваш профиль…', stuck: false });
      },
      onProviderDataCaptured: async () => {
        await closeConnectorSession('linkedin');
      },
      onReady: (result) => {
        onClose();
        return onImportSuccess(result.parsed, result.rawUrl);
      },
    });
    return sessionFlow.current;
  }

  /** Keeps the step audibly alive: every poll says where the flow stands. */
  function noticeFor(
    result: LinkedInSessionPollResult,
  ): LinkedInWaitingNotice | undefined {
    // Any answer at all means the page was readable this time round.
    unreadablePolls.current = 0;
    if (result.status !== 'waiting_for_sign_in') {
      unrecognisedPolls.current = 0;
      return undefined;
    }
    unrecognisedPolls.current =
      result.stage === 'unrecognised' ? unrecognisedPolls.current + 1 : 0;
    return linkedinWaitingNotice(result.stage, unrecognisedPolls.current);
  }

  async function resetSession() {
    sessionFlow.current = undefined;
    signedIn.current = false;
    await resetConnectorSession('linkedin').catch(() => false);
    onClose();
  }

  /**
   * Turns one failed poll into the right outcome.
   *
   * Before the sign-in is recognised nothing has been captured, so a page that
   * cannot be read yet is something to wait through; only a window that is
   * really gone ends the step. After it is recognised, a failed capture ends
   * the attempt once — letting the poll retry hammered the platform and closed
   * the window under the candidate once per second (B157).
   */
  async function handlePollFailure(failure: unknown): Promise<void> {
    const explained = sessionCheckFailure('linkedin', failure);
    if (!signedIn.current) {
      if (explained.step === 'idle') {
        setWaiting(undefined);
        setStep('idle');
        setError(explained.message);
        return;
      }
      unreadablePolls.current += 1;
      setWaiting(
        sessionUnreadableNotice(
          explained.message,
          unreadablePolls.current,
          'Загружаем страницу LinkedIn…',
        ),
      );
      return;
    }
    setAutoPollPaused(true);
    setWaiting(undefined);
    setStep('idle');
    await closeConnectorSession('linkedin').catch(() => undefined);
    signedIn.current = false;
    onConnectionFailure(
      'Вход в LinkedIn выполнен, но получить данные профиля не удалось. Повторите подключение или загрузите PDF-экспорт.',
    );
  }

  useEffect(() => {
    if (
      !isOpen ||
      step !== 'session_open' ||
      autoPollPaused ||
      !isTauriEnvironment()
    ) return;
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          if (cancelled) return;
          const result = await getSessionFlow().run();
          if (cancelled) return;
          setWaiting(noticeFor(result));
        } catch (failure) {
          await handlePollFailure(failure);
        }
      })();
    };
    run();
    const timer = setInterval(run, SESSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step, autoPollPaused]);

  async function checkSession() {
    setAutoPollPaused(false);
    setStep('checking');
    setError(undefined);
    try {
      const result = await getSessionFlow().run();
      if (result.status === 'ready') return;
      // The manual check knows exactly what the page is doing, so it says that
      // instead of one sentence that fits every outcome (B157).
      setWaiting(noticeFor(result));
      setStep('session_open');
      return;
    } catch {
      setAutoPollPaused(true);
      setError(
        'Профиль LinkedIn прочитан, но OpenQareer не подтвердил сохранение. Повторите подключение или загрузите PDF-экспорт.',
      );
      setStep('session_open');
    }
  }

  const route: RouteNotice = routeStarting
    ? { tone: 'pending', text: 'Поднимаем защищённый EU-маршрут LinkedIn…' }
    : platformRouteNotice('linkedin', probe, {
        // Only the desktop companion carries the protected route; in the web
        // build a closed direct path really is the end of this flow.
        protectedRouteAvailable: isTauriEnvironment(),
        protectedRouteActive: tunnelActive,
      });
  // The step is never silent: while the route and the window come up there is
  // nothing to poll yet, and silence is what an undetected sign-in looks like.
  const status: LinkedInWaitingNotice | undefined =
    step === 'opening'
      ? {
          text: routeStarting
            ? 'Готовим защищённый маршрут, окно входа откроется следом…'
            : 'Открываем окно входа LinkedIn…',
          stuck: false,
        }
      : waiting;
  const sessionActive = step !== 'idle';

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={closeModal}
      titleId="linkedin-modal-title"
      title="Подключение LinkedIn"
      icon={<PlatformLogo platform="linkedin" size={26} />}
      wide={isTauriEnvironment() && sessionActive}
    >
      <div className={`career-modal-body${sessionActive ? ' is-connector-session' : ''}`}>
        {sessionActive ? (
          <div className="career-connector-session-toolbar">
            <p className="career-modal-network-status is-compact">
              {route.tone === 'ok' ? (
                <CheckCircle size={16} weight="fill" />
              ) : route.tone === 'blocked' ? (
                <WarningCircle size={16} weight="fill" />
              ) : (
                <ShieldCheck size={16} weight="fill" />
              )}
              <span>{route.text}</span>
            </p>
            <div className="career-connector-session-actions">
              <button
                type="button"
                className="career-quiet-button career-connector-check"
                onClick={() => void resetSession()}
                title="Очистит вход в LinkedIn внутри OpenQareer и закроет окно"
              >
                Выйти из LinkedIn
              </button>
              <button
                type="button"
                className="career-primary-button career-connector-check"
                onClick={() => void checkSession()}
                disabled={step !== 'session_open'}
              >
                {step === 'checking' ? 'Проверяем…' : 'Проверить вход'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="career-modal-network-status">
              {route.tone === 'ok' ? (
                <CheckCircle size={18} weight="fill" />
              ) : route.tone === 'blocked' ? (
                <WarningCircle size={18} weight="fill" />
              ) : (
                <ShieldCheck size={18} weight="fill" />
              )}
              <span>{route.text}</span>
            </p>
            <p className="career-modal-intro">
              Вход проходит на странице самого LinkedIn, в вашей собственной
              сессии. После входа OpenQareer сам загрузит профиль и закроет окно.
            </p>
          </>
        )}

        {step === 'idle' ? (
          <button
            type="button"
            className="career-primary-button career-modal-wide-action"
            onClick={() => void startSession()}
          >
            <ArrowSquareOut size={18} weight="bold" />
            <span>Открыть окно входа в LinkedIn</span>
          </button>
        ) : null}

        {status ? (
          <p
            className={`career-connector-waiting${status.stuck ? ' is-stuck' : ''}`}
            role="status"
          >
            {status.stuck ? (
              <WarningCircle size={16} weight="fill" />
            ) : (
              <SpinnerGap size={16} className="spin" />
            )}
            <span>{status.text}</span>
          </p>
        ) : null}

        {isTauriEnvironment() && step !== 'idle' ? (
          <div
            ref={webviewHost}
            className="career-connector-webview-host"
            role="group"
            aria-label="Вход в LinkedIn"
          >
            {/* Visible only when the native window is not covering this area —
                a blank white rectangle is what the owner saw instead (B157). */}
            <p className="career-connector-webview-placeholder">
              Окно входа LinkedIn открывается поверх этой области. Если его не
              видно, оно может быть свёрнуто или за другим окном — найдите его и
              завершите вход.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="career-modal-error" role="alert">
            <WarningCircle size={18} weight="fill" />
            {error}
          </p>
        ) : null}
      </div>

      {sessionActive ? null : (
        <div className="career-modal-footer is-compact">
          <button type="button" className="career-quiet-button" onClick={closeModal}>
            Отмена
          </button>
        </div>
      )}
    </ImportModalShell>
  );
}
