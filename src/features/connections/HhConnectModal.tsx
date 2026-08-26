import { useEffect, useRef, useState } from 'react';
import type { HhProfileIdentity } from '../../services/connectors/hhProfileParser';
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
  resizeConnectorSession,
  sessionCheckFailure,
  type ConnectorSessionStep,
} from './connectorSession';
import {
  nextAnimationFrame,
  shouldOpenSessionAutomatically,
  shouldPollConnectorSession,
  startConnectorSession,
} from './connectorSessionStart';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';
import { sessionUnreadableNotice } from './sessionWaitingStage';
import {
  createHhSessionImportFlow,
  hhResumeImportFailure,
  hhWaitingNotice,
  readChosenHhResume,
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
  /**
   * The resume the candidate settled on, already read inside their own
   * session. The dialog never reports a connection it has not finished: the
   * old "here is a list, import it somewhere else" hand-off is what left a
   * sign-in window with no owner (owner report, 2026-08-26).
   */
  readonly onConnectSuccess: (
    resumes: readonly HhResumeItem[],
    parsed: ParsedResume,
    rawUrl: string,
  ) => void | Promise<void>;
  readonly onAuthenticatedEmpty: () => void;
  readonly initialUrl?: string;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function HhConnectModal({
  isOpen,
  onClose,
  onConnectSuccess,
  onAuthenticatedEmpty,
}: HhConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const autoOpenAttempted = useRef(false);
  const [error, setError] = useState<string>();
  // `undefined` while the probe is in flight, `null` when there is no
  // measurement to report at all (B167).
  const [probe, setProbe] = useState<{ accessible: boolean } | null>();
  const [emptyAccount, setEmptyAccount] = useState(false);
  const [autoPollPaused, setAutoPollPaused] = useState(false);
  const [waiting, setWaiting] = useState<HhWaitingNotice>();
  /** The account owes a choice; the sign-in window stays up while it is made. */
  const [choice, setChoice] = useState<readonly HhResumeItem[]>();
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [importing, setImporting] = useState(false);
  const webviewHost = useRef<HTMLDivElement>(null);
  const sessionFlow = useRef<HhSessionImportFlow>();
  /** What the profile page stated, kept for the resume the candidate picks. */
  const hhProfile = useRef<HhProfileIdentity>();
  /** This opening of the dialog really did put a sign-in window on screen. */
  const sessionOpened = useRef(false);
  /** The page itself proved the candidate is signed in. */
  const signedIn = useRef(false);
  /** Consecutive polls on a loaded, unchallenged page with no signed-in marker. */
  const unrecognisedPolls = useRef(0);
  /** Consecutive polls that could not read the page at all. */
  const unreadablePolls = useRef(0);

  function closeModal() {
    sessionOpened.current = false;
    sessionFlow.current = undefined;
    void closeConnectorSession('hh').catch(() => undefined);
    onClose();
  }

  // The window belongs to this dialog for its whole life. Letting it outlive
  // the dialog is what put an unowned hh.ru window over the wizard, with the
  // candidate closing it by hand (owner report, 2026-08-26).
  useEffect(
    () => () => {
      void closeConnectorSession('hh').catch(() => undefined);
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
    if (!isOpen) {
      autoOpenAttempted.current = false;
      sessionOpened.current = false;
      setStep('idle');
      return;
    }
    setStep('idle');
    setError(undefined);
    setProbe(undefined);
    setEmptyAccount(false);
    setAutoPollPaused(false);
    setWaiting(undefined);
    setChoice(undefined);
    setSelectedResumeId('');
    setImporting(false);
    signedIn.current = false;
    unrecognisedPolls.current = 0;
    unreadablePolls.current = 0;
    sessionFlow.current = undefined;
    sessionOpened.current = false;
    void probeNetworkStatus()
      .then((status) => setProbe(status ? status.hh : null))
      .catch(() => setProbe(null));
  }, [isOpen]);

  /**
   * B169 §3 — «Подключить» opens the sign-in window, not a page describing it.
   * The dialog used to explain the flow and ask for a second click that had no
   * decision attached to it. The rule is shared and tested so both connectors
   * behave the same, and so a failed open stays manual.
   */
  useEffect(() => {
    if (
      !shouldOpenSessionAutomatically({
        isOpen,
        isDesktop: isTauriEnvironment(),
        step,
        attempted: autoOpenAttempted.current,
      })
    ) {
      return;
    }
    autoOpenAttempted.current = true;
    void startSession();
    // The ref above is what keeps this to a single attempt per opening.
  }, [isOpen, step]);

  /** The step only advances once a window is really on screen (B149, B157). */
  async function startSession() {
    setError(undefined);
    setWaiting(undefined);
    // A retry that reopens the window without restarting the poll is a button
    // that does nothing: the step sat at «Открыть окно входа в hh.ru» forever
    // (owner report, 2026-08-26).
    setAutoPollPaused(false);
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
    sessionOpened.current = started.opened;
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
      onChoiceRequired: (result) => {
        // Nothing left for the poll to detect, and the window stays: the
        // chosen resume is read inside it, a step away.
        setAutoPollPaused(true);
        setWaiting(undefined);
        hhProfile.current = result.profile;
        setChoice(result.resumes);
        setSelectedResumeId(result.resumes[0]?.id ?? '');
      },
      onReady: async (result) => {
        if (!result.defaultParsed || !result.rawUrl) return;
        await finishWithResume(result.resumes, result.defaultParsed, result.rawUrl);
      },
      onAuthenticatedEmpty: async () => {
        setEmptyAccount(true);
        await closeConnectorSession('hh').catch(() => undefined);
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
    // Shown here, next to the retry that fixes it. Handing it to the wizard put
    // the sentence behind the dialog that was still on screen, and left it
    // there through the next, successful attempt (owner report, 2026-08-26).
    setError(
      'Вход в hh.ru выполнен, но список резюме прочитать не удалось. Откройте окно входа ещё раз или загрузите PDF-резюме.',
    );
  }

  /**
   * Hands the read resume to the account and closes down — but only if the
   * account really took it. A server that refused the import used to surface as
   * «список резюме прочитать не удалось» through the poll's failure path, and
   * the poll then tried the same import again every 750 ms.
   */
  async function finishWithResume(
    resumes: readonly HhResumeItem[],
    parsed: ParsedResume,
    rawUrl: string,
  ): Promise<void> {
    try {
      await onConnectSuccess(resumes, parsed, rawUrl);
    } catch (reason) {
      setAutoPollPaused(true);
      setWaiting(undefined);
      setChoice(resumes);
      setSelectedResumeId(
        resumes.find((item) => item.url === rawUrl)?.id ?? resumes[0]?.id ?? '',
      );
      setError(hhResumeImportFailure(reason));
      return;
    }
    await closeConnectorSession('hh').catch(() => undefined);
    onClose();
  }

  /** Reads the resume the candidate chose, in the window they chose it from. */
  async function importChoice() {
    const selected =
      choice?.find((item) => item.id === selectedResumeId) ?? choice?.[0];
    if (!selected) return;
    setImporting(true);
    setError(undefined);
    try {
      const parsed = await readChosenHhResume(
        selected.url,
        {
          readSessionPage: (url) => readSessionPage('hh', url),
          reopenSession: async (url) =>
            (
              await openConnectorSession(
                'hh',
                url,
                sessionLayoutForHost(
                  webviewHost.current,
                  window.innerWidth,
                  window.innerHeight,
                ),
              )
            ).opened,
        },
        hhProfile.current,
      );
      // The dialog only closes once the profile really holds the resume.
      await finishWithResume(choice ?? [], parsed, selected.url);
    } catch (reason) {
      setError(hhResumeImportFailure(reason));
    } finally {
      setImporting(false);
    }
  }

  /**
   * Once the candidate signs in, the product reacts on its own: the poll picks
   * up the resume list inside the live session window and imports it without
   * anyone having to find the manual check button (owner report, B156). The
   * button stays for the cases the quiet poll cannot name.
   */
  useEffect(() => {
    if (
      emptyAccount ||
      !shouldPollConnectorSession({
        isOpen,
        isDesktop: isTauriEnvironment(),
        step,
        sessionOpened: sessionOpened.current,
        paused: autoPollPaused,
      })
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
        {sessionActive ? null : (
          /* The route line belongs to the step that has no window yet, where it
             answers «why is nothing happening». Once the window is on screen it
             is answered, and the owner asked for the line back
             (owner report, 2026-08-26). */
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

        {choice && choice.length > 0 ? (
          /* The choice is made here, where the session that answers it is still
             on screen. It used to be handed to the wizard while this dialog and
             its window went away separately (owner report, 2026-08-26). */
          <div className="career-hh-resumes-selector">
            <label htmlFor="hh-modal-resume-dropdown">
              {choice.length > 1
                ? 'Выберите резюме для импорта'
                : 'Импортируйте резюме в профиль'}
            </label>
            <div className="career-hh-resumes-row">
              <select
                id="hh-modal-resume-dropdown"
                className="career-hh-resumes-select"
                value={selectedResumeId}
                onChange={(event) => setSelectedResumeId(event.target.value)}
                disabled={importing}
              >
                {choice.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="career-primary-button"
                onClick={() => void importChoice()}
                disabled={importing}
              >
                {importing ? 'Импортируем…' : 'Импортировать выбранное резюме'}
              </button>
            </div>
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
