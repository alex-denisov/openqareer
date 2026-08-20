import { useEffect, useState } from 'react';
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
import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import {
  looksLikeLinkedInLoginPage,
  openConnectorSession,
  platformRouteNotice,
  readSessionPage,
  sessionCheckFailure,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
} from './connectorSession';

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

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbe(undefined);
    void probeNetworkStatus()
      .then((status) => setProbe(status.linkedin))
      .catch(() => setProbe({ accessible: false }));
  }, [isOpen]);

  /** The step only advances once a window is really on screen (B149). */
  async function startSession() {
    setError(undefined);
    setStep('opening');
    const result = await openConnectorSession('linkedin', LINKEDIN_LOGIN_URL);
    if (!result.opened) {
      setStep('idle');
      setError(sessionOpenFailureMessage('linkedin', result.reason));
      return;
    }
    setStep('session_open');
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
            onClose();
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

  const route = platformRouteNotice('linkedin', probe);

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="linkedin-modal-title"
      title="Подключение LinkedIn"
      icon={<PlatformLogo platform="linkedin" size={26} />}
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
          Подключение работает через вашу собственную браузерную сессию на этом
          устройстве. Логин и пароль остаются в окне LinkedIn и не проходят через
          наши серверы.
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
          onClick={onClose}
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
