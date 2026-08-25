import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, CheckCircle, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { isTauriEnvironment, probeNetworkStatus } from '../../services/desktop/desktopBridge';
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
  sessionCheckFailure,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
} from './connectorSession';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';
import {
  createHhSessionImportFlow,
  hhWaitingNotice,
  type HhSessionImportFlow,
  type HhResumeItem,
  type HhSessionPollResult,
  type HhWaitingNotice,
} from './hhSessionPoll';

export type { HhResumeItem } from './hhSessionPoll';

const SESSION_POLL_INTERVAL_MS = 750;

const HH_LOGIN_URL = 'https://hh.ru/account/login';

export interface HhConnectModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConnectSuccess: (
    resumes: HhResumeItem[],
    defaultParsed?: ParsedResume,
    rawUrl?: string,
  ) => void | Promise<void>;
  readonly onAuthenticatedEmpty: () => void;
  readonly onConnectionFailure: (message: string) => void;
  readonly initialUrl?: string;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function HhConnectModal({
  isOpen,
  onClose,
  onConnectSuccess,
  onAuthenticatedEmpty,
  onConnectionFailure,
}: HhConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const [error, setError] = useState<string>();
  const [probe, setProbe] = useState<{ accessible: boolean }>();
  const [emptyAccount, setEmptyAccount] = useState(false);
  const [autoPollPaused, setAutoPollPaused] = useState(false);
  const [waiting, setWaiting] = useState<HhWaitingNotice>();
  const webviewHost = useRef<HTMLDivElement>(null);
  const sessionFlow = useRef<HhSessionImportFlow>();
  const backgroundCapture = useRef(false);
  /** Consecutive polls on a loaded, unchallenged page with no signed-in marker. */
  const unrecognisedPolls = useRef(0);

  function closeModal() {
    sessionFlow.current = undefined;
    void closeConnectorSession('hh');
    onClose();
  }

  useEffect(
    () => () => {
      if (!backgroundCapture.current) void closeConnectorSession('hh');
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !isTauriEnvironment() || step === 'idle' || step === 'opening') return;
    const host = webviewHost.current;
    if (!host) return;
    return watchConnectorHost('hh', host, (layout) => {
      void resizeConnectorSession('hh', layout);
    });
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbe(undefined);
    setEmptyAccount(false);
    setAutoPollPaused(false);
    setWaiting(undefined);
    backgroundCapture.current = false;
    unrecognisedPolls.current = 0;
    sessionFlow.current = undefined;
    void probeNetworkStatus()
      .then((status) => setProbe(status.hh))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  /** The step only advances once a window is really on screen (B149). */
  async function startSession() {
    setError(undefined);
    setWaiting(undefined);
    unrecognisedPolls.current = 0;
    setStep('opening');
    setStep('session_open');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const layout = sessionLayoutForHost(
      webviewHost.current,
      window.innerWidth,
      window.innerHeight,
    );
    const result = await openConnectorSession('hh', HH_LOGIN_URL, layout);
    if (!result.opened) {
      setStep('idle');
      setError(sessionOpenFailureMessage('hh', result.reason));
      return;
    }
  }

  function getSessionFlow(): HhSessionImportFlow {
    if (sessionFlow.current) return sessionFlow.current;
    sessionFlow.current = createHhSessionImportFlow({
      inspectCurrentPage: () => inspectSessionPage('hh'),
      readSessionPage: (url) => readSessionPage('hh', url),
      onAuthenticated: async () => {
        backgroundCapture.current = true;
        const hidden = await hideConnectorSession('hh').catch(() => false);
        if (!hidden) {
          backgroundCapture.current = false;
          throw new Error('hh_session_hide_failed');
        }
        onClose();
      },
      onProviderDataCaptured: async (result) => {
        if (result.status !== 'ready' || result.defaultParsed) {
          await closeConnectorSession('hh');
          backgroundCapture.current = false;
        }
      },
      onReady: (result) =>
        onConnectSuccess(result.resumes, result.defaultParsed, result.rawUrl),
      onAuthenticatedEmpty: () => {
        setEmptyAccount(true);
        onAuthenticatedEmpty();
      },
    });
    return sessionFlow.current;
  }

  /** Keeps the step audibly alive: every poll says where the flow stands. */
  function noticeFor(result: HhSessionPollResult): HhWaitingNotice | undefined {
    if (result.status !== 'waiting_for_sign_in') {
      unrecognisedPolls.current = 0;
      return undefined;
    }
    unrecognisedPolls.current =
      result.stage === 'unrecognised' ? unrecognisedPolls.current + 1 : 0;
    return hhWaitingNotice(result.stage, unrecognisedPolls.current);
  }

  async function resetSession() {
    sessionFlow.current = undefined;
    backgroundCapture.current = false;
    await resetConnectorSession('hh').catch(() => false);
    onClose();
  }

  /**
   * Once the candidate signs in, the product reacts on its own: the poll picks
   * up the resume list inside the live session window and imports it without
   * anyone having to find the manual check button (owner report, B156). The
   * button stays for the cases the quiet poll cannot name.
   */
  useEffect(() => {
    if (
      !isOpen ||
      step !== 'session_open' ||
      emptyAccount ||
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
          // A window the candidate closed is not a failed capture, and saying
          // so was the flow's own way of hiding what actually happened (B157).
          if (!backgroundCapture.current) {
            const explained = sessionCheckFailure('hh', failure);
            if (explained.step === 'idle') {
              setWaiting(undefined);
              setStep('idle');
              setError(explained.message);
              return;
            }
          }
          await closeConnectorSession('hh').catch(() => undefined);
          backgroundCapture.current = false;
          onConnectionFailure(
            'Вход в hh.ru выполнен, но получить данные профиля не удалось. Повторите подключение или загрузите PDF.',
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
  }, [isOpen, step, emptyAccount, autoPollPaused]);

  async function checkSession() {
    setAutoPollPaused(false);
    setStep('checking');
    setError(undefined);
    try {
      if (isTauriEnvironment()) {
        const result = await getSessionFlow().run();
        if (result.status !== 'waiting_for_sign_in') {
          return;
        }
        // The manual check knows exactly what the page is doing, so it says
        // that instead of one sentence that fits every outcome (B157).
        setWaiting(noticeFor(result));
        setStep('session_open');
        return;
      }
      setError(
        'Активную сессию hh.ru найти не удалось. Войдите в аккаунт соискателя в окне hh.ru или загрузите PDF резюме.',
      );
      setStep('session_open');
    } catch {
      setAutoPollPaused(true);
      setError(
        'Данные hh.ru прочитаны, но OpenQareer не подтвердил сохранение. Повторите подключение или загрузите PDF.',
      );
      setStep('session_open');
    }
  }

  const route = platformRouteNotice('hh', probe);
  const sessionActive = step !== 'idle' && step !== 'opening';

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={closeModal}
      titleId="hh-modal-title"
      title="Подключение hh.ru"
      icon={<PlatformLogo platform="hh" size={26} />}
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
              ) : null}
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
              ) : null}
              <span>{route.text}</span>
            </p>
            <p className="career-modal-intro">
              Войдите в hh.ru. После входа OpenQareer сам загрузит резюме и закроет окно.
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
                <span>Открыть окно входа в hh.ru</span>
              </>
            )}
          </button>
        ) : null}

        {waiting ? (
          <p
            className={`career-connector-waiting${waiting.stuck ? ' is-stuck' : ''}`}
            role="status"
          >
            {waiting.stuck ? (
              <WarningCircle size={16} weight="fill" />
            ) : (
              <SpinnerGap size={16} className="spin" />
            )}
            <span>{waiting.text}</span>
          </p>
        ) : null}

        {isTauriEnvironment() && step !== 'idle' && step !== 'opening' ? (
          <div
            ref={webviewHost}
            className="career-connector-webview-host"
            role="group"
            aria-label="Вход в hh.ru"
          >
            {/* Visible only when the native window is not covering this area —
                a blank white rectangle is what the owner saw instead (B157). */}
            <p className="career-connector-webview-placeholder">
              Окно входа hh.ru открывается поверх этой области. Если его не
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
