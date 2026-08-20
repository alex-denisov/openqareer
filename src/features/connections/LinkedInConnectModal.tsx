import { useEffect, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  isTauriEnvironment,
  probeNetworkStatus,
} from '../../services/desktop/desktopBridge';
import { setStoredSessionToken } from '../coach/apiClient';
import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import {
  looksLikeLinkedInLoginPage,
  closeConnectorSession,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  resizeConnectorSession,
  sessionCheckFailure,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
} from './connectorSession';
import {
  ProtectedRouteError,
  startLinkedInProtectedRoute,
} from './linkedinProtectedRoute';

const LINKEDIN_PROFILE_URL = 'https://www.linkedin.com/in/me/';
const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';

export interface LinkedInConnectModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onImportSuccess: (parsed: ParsedResume, rawUrl: string) => void;
  readonly initialUrl?: string;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function LinkedInConnectModal({
  isOpen,
  onClose,
  onImportSuccess,
}: LinkedInConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const [error, setError] = useState<string>();
  const [probe, setProbe] = useState<{ accessible: boolean }>();
  const [tunnelActive, setTunnelActive] = useState(false);
  const webviewHost = useRef<HTMLDivElement>(null);

  function closeModal() {
    void closeConnectorSession('linkedin');
    onClose();
  }

  useEffect(() => () => void closeConnectorSession('linkedin'), []);

  useEffect(() => {
    if (!isOpen || !isTauriEnvironment() || step === 'idle' || step === 'opening') return;
    const host = webviewHost.current;
    if (!host) return;
    const updateBounds = () => {
      const rect = host.getBoundingClientRect();
      void resizeConnectorSession('linkedin', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(host);
    window.addEventListener('resize', updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbe(undefined);
    setTunnelActive(false);
    void probeNetworkStatus()
      .then((status) => setProbe(status.linkedin))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  /** The step only advances once a window is really on screen (B149). */
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
          void closeConnectorSession('linkedin');
          onClose();
          window.history.pushState(null, '', '/login');
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        setStep('idle');
        setTunnelActive(false);
        setError(
          'Защищённый маршрут LinkedIn не запустился. Перезапустите приложение и повторите попытку или загрузите PDF-экспорт.',
        );
        return;
      }
    }
    setStep('session_open');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const rect = webviewHost.current?.getBoundingClientRect();
    const result = await openConnectorSession(
      'linkedin',
      LINKEDIN_LOGIN_URL,
      rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
    );
    if (!result.opened) {
      setStep('idle');
      setError(sessionOpenFailureMessage('linkedin', result.reason));
      return;
    }
  }

  async function checkSession() {
    setStep('checking');
    setError(undefined);
    try {
      if (isTauriEnvironment()) {
        const page = await readSessionPage('linkedin', LINKEDIN_PROFILE_URL);
        if (page.ok && page.body) {
          if (looksLikeLinkedInLoginPage(page.body)) {
            setError(
              'Вход в LinkedIn ещё не завершён. Войдите в открывшемся окне и повторите проверку.',
            );
            setStep('session_open');
            return;
          }
          const parsed = parseResumeContent(page.body);
          if (parsed.fullName || parsed.experience.length > 0) {
            onImportSuccess(parsed, LINKEDIN_PROFILE_URL);
            closeModal();
            return;
          }
        }
      }
      setError(
        'Активную сессию LinkedIn найти не удалось. Войдите в окне сессии или загрузите PDF-экспорт профиля.',
      );
      setStep('session_open');
    } catch (reason) {
      const failure = sessionCheckFailure('linkedin', reason);
      setError(failure.message);
      setStep(failure.step);
    }
  }

  const route = tunnelActive
    ? { tone: 'ok' as const, text: 'Защищённый EU-маршрут LinkedIn активен' }
    : isTauriEnvironment() && probe?.accessible === false
      ? {
          tone: 'pending' as const,
          text: 'Прямой маршрут недоступен — при открытии входа запустим защищённый EU-маршрут',
        }
      : platformRouteNotice('linkedin', probe);

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={closeModal}
      titleId="linkedin-modal-title"
      title="Подключение LinkedIn"
      icon={<PlatformLogo platform="linkedin" size={26} />}
      wide={isTauriEnvironment() && step !== 'idle' && step !== 'opening'}
    >
      <div className="career-modal-body">
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
          Подключение работает через вашу собственную браузерную сессию на этом устройстве. Логин и
          пароль остаются в окне LinkedIn и не проходят через наши серверы.
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
                <span>Открыть окно входа в LinkedIn</span>
              </>
            )}
          </button>
        ) : (
          <div className="career-modal-steps">
            <strong>
              <PlatformLogo platform="linkedin" size={20} />
              Окно сессии LinkedIn открыто
            </strong>
            <ol>
              <li>Войдите в свой аккаунт LinkedIn в открывшемся окне.</li>
              <li>Вернитесь сюда и нажмите «Проверить сессию».</li>
            </ol>
          </div>
        )}

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
              <span>Проверить сессию и импортировать</span>
            )}
          </button>
        )}
      </div>
    </ImportModalShell>
  );
}
