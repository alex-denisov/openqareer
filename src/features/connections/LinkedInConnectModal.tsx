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
  hideConnectorSession,
  inspectSessionPage,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  resetConnectorSession,
  resizeConnectorSession,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
} from './connectorSession';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';
import {
  createLinkedInSessionImportFlow,
  type LinkedInSessionImportFlow,
} from './linkedinSessionPoll';
import {
  ProtectedRouteError,
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
  const [autoPollPaused, setAutoPollPaused] = useState(false);
  const webviewHost = useRef<HTMLDivElement>(null);
  const sessionFlow = useRef<LinkedInSessionImportFlow>();
  const backgroundCapture = useRef(false);

  function closeModal() {
    sessionFlow.current = undefined;
    void closeConnectorSession('linkedin');
    onClose();
  }

  useEffect(
    () => () => {
      if (!backgroundCapture.current) void closeConnectorSession('linkedin');
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !isTauriEnvironment() || step === 'idle' || step === 'opening') return;
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
    setAutoPollPaused(false);
    backgroundCapture.current = false;
    sessionFlow.current = undefined;
    void probeNetworkStatus()
      .then((status) => setProbe(status.linkedin))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  async function startSession() {
    setError(undefined);
    setStep('opening');
    if (isTauriEnvironment()) {
      try {
        const route = await startLinkedInProtectedRoute();
        setProbe(route.probe);
        setTunnelActive(route.tunnelActive);
      } catch (reason) {
        if (reason instanceof ProtectedRouteError && reason.code === 'session_expired') {
          setStoredSessionToken(null);
          closeModal();
          window.history.pushState(null, '', '/login');
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        setStep('idle');
        setError(
          'Маршрут LinkedIn не запустился. Перезапустите приложение и повторите попытку или загрузите PDF-экспорт.',
        );
        return;
      }
    }
    setStep('session_open');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const layout = sessionLayoutForHost(
      webviewHost.current,
      window.innerWidth,
      window.innerHeight,
    );
    const result = await openConnectorSession('linkedin', LINKEDIN_LOGIN_URL, layout);
    if (!result.opened) {
      setStep('idle');
      setError(sessionOpenFailureMessage('linkedin', result.reason));
    }
  }

  function getSessionFlow(): LinkedInSessionImportFlow {
    if (sessionFlow.current) return sessionFlow.current;
    sessionFlow.current = createLinkedInSessionImportFlow({
      inspectCurrentPage: () => inspectSessionPage('linkedin'),
      readSessionPage: (url) => readSessionPage('linkedin', url),
      onAuthenticated: async () => {
        backgroundCapture.current = true;
        const hidden = await hideConnectorSession('linkedin').catch(() => false);
        if (!hidden) {
          backgroundCapture.current = false;
          throw new Error('linkedin_session_hide_failed');
        }
        onClose();
      },
      onProviderDataCaptured: async () => {
        await closeConnectorSession('linkedin');
        backgroundCapture.current = false;
      },
      onReady: (result) => onImportSuccess(result.parsed, result.rawUrl),
    });
    return sessionFlow.current;
  }

  async function resetSession() {
    sessionFlow.current = undefined;
    backgroundCapture.current = false;
    await resetConnectorSession('linkedin').catch(() => false);
    onClose();
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
          if (!cancelled) await getSessionFlow().run();
        } catch {
          await closeConnectorSession('linkedin').catch(() => undefined);
          backgroundCapture.current = false;
          onConnectionFailure(
            'Вход в LinkedIn выполнен, но получить данные профиля не удалось. Повторите подключение или загрузите PDF-экспорт.',
          );
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
      setError(
        'Активную сессию LinkedIn найти не удалось. Завершите вход в открытом окне или загрузите PDF-экспорт.',
      );
      setStep('session_open');
    } catch {
      setAutoPollPaused(true);
      setError(
        'Профиль LinkedIn прочитан, но OpenQareer не подтвердил сохранение. Повторите подключение или загрузите PDF-экспорт.',
      );
      setStep('session_open');
    }
  }

  const route = tunnelActive
    ? { tone: 'ok' as const, text: 'Защищённый EU-маршрут LinkedIn активен' }
    : platformRouteNotice('linkedin', probe);
  const sessionActive = step !== 'idle' && step !== 'opening';

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
              >
                Выйти из сессии
              </button>
              <button
                type="button"
                className="career-primary-button career-connector-check"
                onClick={() => void checkSession()}
                disabled={step === 'checking'}
              >
                {step === 'checking' ? 'Проверяем…' : 'Подтвердить вход'}
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
              Войдите в LinkedIn. После входа OpenQareer сам загрузит профиль и закроет окно.
            </p>
          </>
        )}

        {step === 'idle' || step === 'opening' ? (
          <button
            type="button"
            className="career-primary-button career-modal-wide-action"
            onClick={() => void startSession()}
            disabled={step === 'opening'}
          >
            {step === 'opening' ? (
              <>
                <SpinnerGap size={18} className="spin" />
                <span>Открываем окно входа…</span>
              </>
            ) : (
              <>
                <ArrowSquareOut size={18} weight="bold" />
                <span>Открыть окно входа в LinkedIn</span>
              </>
            )}
          </button>
        ) : null}

        {isTauriEnvironment() && step !== 'idle' && step !== 'opening' ? (
          <div
            ref={webviewHost}
            className="career-connector-webview-host"
            aria-label="Вход в LinkedIn"
          />
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
