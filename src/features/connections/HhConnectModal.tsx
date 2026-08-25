import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { isTauriEnvironment, probeNetworkStatus } from '../../services/desktop/desktopBridge';
import type { ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import { RouteNoticeLine } from './RouteNoticeLine';
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
} from './connectorSession';
import {
  nextAnimationFrame,
  startConnectorSession,
} from './connectorSessionStart';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';
import { sessionUnreadableNotice } from './sessionWaitingStage';
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
  // `undefined` while the probe is in flight, `null` when there is no
  // measurement to report at all (B167).
  const [probe, setProbe] = useState<{ accessible: boolean } | null>();
  const [emptyAccount, setEmptyAccount] = useState(false);
  const [autoPollPaused, setAutoPollPaused] = useState(false);
  const [waiting, setWaiting] = useState<HhWaitingNotice>();
  const webviewHost = useRef<HTMLDivElement>(null);
  const sessionFlow = useRef<HhSessionImportFlow>();
  /** The page itself proved the candidate is signed in. */
  const signedIn = useRef(false);
  /** The candidate still has to pick a resume out of this live session. */
  const keepSessionOpen = useRef(false);
  /** Consecutive polls on a loaded, unchallenged page with no signed-in marker. */
  const unrecognisedPolls = useRef(0);
  /** Consecutive polls that could not read the page at all. */
  const unreadablePolls = useRef(0);

  function closeModal() {
    sessionFlow.current = undefined;
    void closeConnectorSession('hh');
    onClose();
  }

  useEffect(
    () => () => {
      if (!keepSessionOpen.current) void closeConnectorSession('hh');
    },
    [],
  );

  useEffect(() => {
    if (!isOpen || !isTauriEnvironment() || step === 'idle') return;
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
    signedIn.current = false;
    keepSessionOpen.current = false;
    unrecognisedPolls.current = 0;
    unreadablePolls.current = 0;
    sessionFlow.current = undefined;
    void probeNetworkStatus()
      .then((status) => setProbe(status ? status.hh : null))
      .catch(() => setProbe(null));
  }, [isOpen]);

  /** The step only advances once a window is really on screen (B149, B157). */
  async function startSession() {
    setError(undefined);
    setWaiting(undefined);
    unrecognisedPolls.current = 0;
    unreadablePolls.current = 0;
    const started = await startConnectorSession({
      platform: 'hh',
      url: HH_LOGIN_URL,
      measureLayout: () =>
        sessionLayoutForHost(webviewHost.current, window.innerWidth, window.innerHeight),
      waitForFrame: nextAnimationFrame,
      onStep: setStep,
      openSession: openConnectorSession,
    });
    if (!started.opened) setError(started.error);
  }

  function getSessionFlow(): HhSessionImportFlow {
    if (sessionFlow.current) return sessionFlow.current;
    sessionFlow.current = createHhSessionImportFlow({
      inspectCurrentPage: () => inspectSessionPage('hh'),
      readSessionPage: (url) => readSessionPage('hh', url),
      onAuthenticated: () => {
        // The sign-in window stays on screen while the resume list is read. A
        // hidden WKWebView stops running the script that read depends on, so
        // parking it here failed every capture that followed a perfectly good
        // sign-in — and the step then reported the import as failed (B157).
        signedIn.current = true;
        setWaiting({ text: 'Вход выполнен — читаем список ваших резюме…', stuck: false });
      },
      onProviderDataCaptured: async (result) => {
        // The session is only kept alive while the candidate still has to pick
        // a resume out of it: that read happens in this same window.
        if (result.status !== 'ready' || result.defaultParsed) {
          await closeConnectorSession('hh');
        } else {
          keepSessionOpen.current = true;
        }
      },
      onReady: (result) => {
        onClose();
        return onConnectSuccess(result.resumes, result.defaultParsed, result.rawUrl);
      },
      onAuthenticatedEmpty: () => {
        setEmptyAccount(true);
        onClose();
        onAuthenticatedEmpty();
      },
    });
    return sessionFlow.current;
  }

  /** Keeps the step audibly alive: every poll says where the flow stands. */
  function noticeFor(result: HhSessionPollResult): HhWaitingNotice | undefined {
    // Any answer at all means the page was readable this time round.
    unreadablePolls.current = 0;
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
    signedIn.current = false;
    keepSessionOpen.current = false;
    await resetConnectorSession('hh').catch(() => false);
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
    const explained = sessionCheckFailure('hh', failure);
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
          'Загружаем страницу hh.ru…',
        ),
      );
      return;
    }
    setAutoPollPaused(true);
    setWaiting(undefined);
    setStep('idle');
    await closeConnectorSession('hh').catch(() => undefined);
    signedIn.current = false;
    onConnectionFailure(
      'Вход в hh.ru выполнен, но получить данные профиля не удалось. Повторите подключение или загрузите PDF.',
    );
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
  // The step is never silent: while the window is being built there is nothing
  // to poll yet, and silence is exactly what an undetected sign-in looks like.
  const status: HhWaitingNotice | undefined =
    step === 'opening'
      ? { text: 'Открываем окно входа hh.ru…', stuck: false }
      : waiting;
  // The frame is part of the step from the moment the window is being opened:
  // it is what the native window is measured against, and it is where the
  // candidate's own controls live.
  const sessionActive = step !== 'idle';

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
            <RouteNoticeLine notice={route} compact />
            <div className="career-connector-session-actions">
              <button
                type="button"
                className="career-quiet-button career-connector-check"
                onClick={() => void resetSession()}
                title="Очистит вход в hh.ru внутри OpenQareer и закроет окно"
              >
                Выйти из hh.ru
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
            <RouteNoticeLine notice={route} />
            <p className="career-modal-intro">
              Вход проходит на странице самой hh.ru, в вашей собственной сессии.
              После входа OpenQareer сам загрузит резюме и закроет окно. Если
              резюме несколько, вы выберете нужное.
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
            <span>Открыть окно входа в hh.ru</span>
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
