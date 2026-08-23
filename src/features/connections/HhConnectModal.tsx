import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, CheckCircle, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { isTauriEnvironment, probeNetworkStatus } from '../../services/desktop/desktopBridge';
import { parseHhResumeHtml, parseHhResumesList } from '../../services/connectors/hhResumeParser';
import type { ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import {
  looksLikeHhLoginPage,
  closeConnectorSession,
  looksLikeHhVpnBlock,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  resizeConnectorSession,
  sessionCheckFailure,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
} from './connectorSession';
import { sessionLayoutForHost, watchConnectorHost } from './connectorLayout';

const SESSION_POLL_INTERVAL_MS = 4000;

const HH_RESUME_LIST_URL = 'https://hh.ru/applicant/resumes';
const HH_LOGIN_URL = 'https://hh.ru/account/login';

export interface HhResumeItem {
  id: string;
  title: string;
  url: string;
  updatedLabel?: string;
}

export interface HhConnectModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConnectSuccess: (
    resumes: HhResumeItem[],
    defaultParsed?: ParsedResume,
    rawUrl?: string,
  ) => void;
  readonly initialUrl?: string;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function HhConnectModal({ isOpen, onClose, onConnectSuccess }: HhConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const [error, setError] = useState<string>();
  const [probe, setProbe] = useState<{ accessible: boolean }>();
  const webviewHost = useRef<HTMLDivElement>(null);

  function closeModal() {
    void closeConnectorSession('hh');
    onClose();
  }

  useEffect(() => () => void closeConnectorSession('hh'), []);

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
    void probeNetworkStatus()
      .then((status) => setProbe(status.hh))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  /** The step only advances once a window is really on screen (B149). */
  async function startSession() {
    setError(undefined);
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

  /**
   * Once the candidate signs in, the product reacts on its own: the poll picks
   * up the resume list inside the live session window and imports it without
   * anyone having to find the manual check button (owner report, B156). The
   * button stays for the cases the quiet poll cannot name.
   */
  useEffect(() => {
    if (!isOpen || step !== 'session_open' || !isTauriEnvironment()) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          if (cancelled) return;
          const page = await readSessionPage('hh', HH_RESUME_LIST_URL);
          if (!page.body || cancelled) return;
          if (looksLikeHhVpnBlock(page.body) || looksLikeHhLoginPage(page.body)) return;
          const resumes = parseHhResumesList(page.body);
          if (resumes.length > 0 && !cancelled) {
            onConnectSuccess(resumes, await readFirstResume(resumes[0].url), resumes[0].url);
            closeModal();
          }
        } catch {
          // Quiet by design: the manual check reports failures honestly.
        }
      })();
    }, SESSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step]);

  async function checkSession() {
    setStep('checking');
    setError(undefined);
    try {
      if (isTauriEnvironment()) {
        const page = await readSessionPage('hh', HH_RESUME_LIST_URL);
        if (page.body) {
          if (looksLikeHhVpnBlock(page.body)) {
            setError(
              'hh.ru закрывает доступ при включённом VPN. Отключите VPN для hh.ru или загрузите резюме PDF-файлом.',
            );
            setStep('session_open');
            return;
          }
          if (looksLikeHhLoginPage(page.body)) {
            setError(
              'Вход на hh.ru ещё не завершён. Войдите в открывшемся окне и повторите проверку.',
            );
            setStep('session_open');
            return;
          }
          const resumes = parseHhResumesList(page.body);
          if (resumes.length > 0) {
            onConnectSuccess(resumes, await readFirstResume(resumes[0].url), resumes[0].url);
            closeModal();
            return;
          }
        }
      }
      setError(
        'Активную сессию hh.ru найти не удалось. Войдите в аккаунт соискателя в окне hh.ru или загрузите PDF резюме.',
      );
      setStep('session_open');
    } catch (reason) {
      const failure = sessionCheckFailure('hh', reason);
      setError(failure.message);
      setStep(failure.step);
    }
  }

  const route = platformRouteNotice('hh', probe);

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={closeModal}
      titleId="hh-modal-title"
      title="Подключение hh.ru"
      icon={<PlatformLogo platform="hh" size={26} />}
      wide={isTauriEnvironment() && step !== 'idle' && step !== 'opening'}
    >
      <div className="career-modal-body">
        <p className="career-modal-network-status">
          {route.tone === 'ok' ? (
            <CheckCircle size={18} weight="fill" />
          ) : route.tone === 'blocked' ? (
            <WarningCircle size={18} weight="fill" />
          ) : null}
          <span>{route.text}</span>
        </p>

        <p className="career-modal-intro">
          Подключение читает список ваших резюме через вашу собственную сессию соискателя. Мы ничего
          не публикуем и не откликаемся от вашего имени.
        </p>

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
        ) : (
          <div className="career-modal-steps">
            <strong>
              <PlatformLogo platform="hh" size={20} />
              Окно сессии hh.ru открыто
            </strong>
            <ol>
              <li>Войдите в аккаунт соискателя в открывшемся окне.</li>
              <li>
                Как только вход завершится, резюме подхватятся сами — или
                нажмите «Проверить сессию».
              </li>
            </ol>
          </div>
        )}

        {isTauriEnvironment() && step !== 'idle' && step !== 'opening' ? (
          <div
            ref={webviewHost}
            className="career-connector-webview-host"
            aria-label="Вход в hh.ru"
          />
        ) : null}

        {error ? (
          <p className="career-modal-error" role="alert">
            <WarningCircle size={18} weight="fill" />
            {error}
          </p>
        ) : null}
      </div>

      <div className="career-modal-footer">
        <button
          type="button"
          className="career-quiet-button"
          onClick={closeModal}
          disabled={step === 'checking'}
        >
          Отмена
        </button>
        {step === 'idle' || step === 'opening' ? null : (
          <button
            type="button"
            className="career-primary-button"
            onClick={() => void checkSession()}
            disabled={step === 'checking'}
          >
            {step === 'checking' ? (
              <>
                <SpinnerGap size={18} className="spin" />
                <span>Проверяем сессию…</span>
              </>
            ) : (
              <span>Проверить сессию и загрузить резюме</span>
            )}
          </button>
        )}
      </div>
    </ImportModalShell>
  );
}

async function readFirstResume(url: string): Promise<ParsedResume | undefined> {
  try {
    const page = await readSessionPage('hh', url);
    return page.body ? parseHhResumeHtml(page.body, url) : undefined;
  } catch {
    // The list alone is already useful; the candidate picks a resume next.
    return undefined;
  }
}
