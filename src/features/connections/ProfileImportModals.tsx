import { useEffect, useState } from 'react';
import {
  CheckCircle,
  GlobeHemisphereWest,
  LockSimple,
  ShieldCheck,
  WarningCircle,
  X,
  ArrowSquareOut,
  SpinnerGap,
} from '@phosphor-icons/react';
import {
  desktopNativeFetch,
  isTauriEnvironment,
  probeNetworkStatus,
  type NetworkEnvironmentStatus,
} from '../../services/desktop/desktopBridge';
import {
  parseHhResumeHtml,
  parseHhResumesList,
} from '../../services/connectors/hhResumeParser';
import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';

export interface HhResumeItem {
  id: string;
  title: string;
  url: string;
  updatedLabel?: string;
}

interface LinkedInConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (parsed: ParsedResume, rawUrl: string) => void;
  initialUrl?: string;
}

// eslint-disable-next-line max-lines-per-function
export function LinkedInConnectModal({
  isOpen,
  onClose,
  onImportSuccess,
}: LinkedInConnectModalProps) {
  const [step, setStep] = useState<'idle' | 'session_open' | 'checking'>('idle');
  const [error, setError] = useState<string>();
  const [networkStatus, setNetworkStatus] = useState<NetworkEnvironmentStatus>();

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    void probeNetworkStatus().then((status) => {
      setNetworkStatus(status);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  function handleOpenSession() {
    setError(undefined);
    setStep('session_open');
    if (typeof window !== 'undefined') {
      window.open(
        'https://www.linkedin.com/login',
        'OpenQareer_LinkedIn_Session',
        'width=800,height=700,menubar=no,toolbar=no,location=yes,status=no',
      );
    }
  }

  async function handleCheckSession() {
    setStep('checking');
    setError(undefined);

    try {
      if (isTauriEnvironment()) {
        const nativeRes = await desktopNativeFetch({
          url: 'https://www.linkedin.com/in/me/',
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (nativeRes && nativeRes.ok && nativeRes.body) {
          const isLoginPage =
            nativeRes.body.includes('linkedin.com/checkpoint') ||
            nativeRes.body.includes('session_password') ||
            nativeRes.body.includes('join-form');

          if (isLoginPage) {
            setError(
              'Сессия LinkedIn ещё не активна. Пожалуйста, выполните вход в открывшемся окне и повторите проверку.',
            );
            setStep('session_open');
            return;
          }

          const parsed = parseResumeContent(nativeRes.body);
          if (parsed.fullName || parsed.experience.length > 0) {
            onImportSuccess(parsed, 'https://www.linkedin.com/in/me/');
            onClose();
            return;
          }
        }
      }

      setError(
        'Не удалось обнаружить активную сессию LinkedIn. Убедитесь, что вы вошли в аккаунт в окне сессии, либо загрузите экспорт резюме в формате PDF.',
      );
      setStep('session_open');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось проверить сессию LinkedIn. Повторите попытку или загрузите PDF.',
      );
      setStep('session_open');
    }
  }

  return (
    <div
      className="career-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="linkedin-modal-title"
    >
      <div className="career-modal-card">
        <div className="career-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <GlobeHemisphereWest
              size={24}
              weight="bold"
              style={{ color: '#0077b5' }}
            />
            <h2 id="linkedin-modal-title">Подключение LinkedIn</h2>
          </div>
          <button
            type="button"
            className="career-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="career-modal-body">
          <div className="career-modal-network-status">
            <ShieldCheck size={18} weight="fill" style={{ color: '#22c55e' }} />
            <span>
              {networkStatus?.recommendation === 'tunnel_required'
                ? 'Защищённый VLESS туннель активен для безопасного подключения LinkedIn'
                : 'Прямой маршрут LinkedIn проверен и активен'}
            </span>
          </div>

          <p className="career-modal-intro">
            OpenQareer подключается к LinkedIn через защищённую браузерную
            сессию на вашем устройстве. Ваши логин и пароль остаются строго в
            вашем браузере и никогда не передаются на сервер.
          </p>

          {step === 'idle' ? (
            <div style={{ padding: '16px 0' }}>
              <button
                type="button"
                className="career-primary-button"
                onClick={handleOpenSession}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  justifyContent: 'center',
                  padding: '12px 20px',
                }}
              >
                <ArrowSquareOut size={18} weight="bold" />
                <span>Открыть окно входа в LinkedIn</span>
              </button>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '16px',
                margin: '12px 0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '8px',
                }}
              >
                <GlobeHemisphereWest
                  size={20}
                  weight="bold"
                  style={{ color: '#0077b5' }}
                />
                <strong style={{ color: '#ffffff' }}>
                  Окно сессии LinkedIn открыто
                </strong>
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--career-text-dim, #94a3b8)',
                  margin: 0,
                  lineHeight: '1.4',
                }}
              >
                1. Выполните вход в ваш аккаунт LinkedIn в открывшемся окне.
                <br />
                2. После успешной авторизации нажмите кнопку ниже для
                импорта профиля в Resume Studio.
              </p>
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
            Закрыть
          </button>
          {step === 'session_open' || step === 'checking' ? (
            <button
              type="button"
              className="career-primary-button"
              onClick={() => void handleCheckSession()}
              disabled={step === 'checking'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function fetchFirstHhResumeDetail(
  url: string,
): Promise<ParsedResume | undefined> {
  try {
    const res = await desktopNativeFetch({
      url,
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (res?.body) {
      return parseHhResumeHtml(res.body, url);
    }
  } catch {
    // Non-blocking
  }
  return undefined;
}

interface HhConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectSuccess: (
    resumes: HhResumeItem[],
    defaultParsed?: ParsedResume,
    rawUrl?: string,
  ) => void;
  initialUrl?: string;
}

// eslint-disable-next-line max-lines-per-function
export function HhConnectModal({
  isOpen,
  onClose,
  onConnectSuccess,
}: HhConnectModalProps) {
  const [step, setStep] = useState<'idle' | 'session_open' | 'checking'>('idle');
  const [error, setError] = useState<string>();
  const [probing, setProbing] = useState(false);
  const [isVpnSafe, setIsVpnSafe] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbing(true);

    void probeNetworkStatus()
      .then((status) => {
        setIsVpnSafe(status.hh.accessible);
      })
      .catch(() => {
        setIsVpnSafe(true);
      })
      .finally(() => {
        setProbing(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  function handleOpenSession() {
    setError(undefined);
    setStep('session_open');
    if (typeof window !== 'undefined') {
      window.open(
        'https://hh.ru/account/login',
        'OpenQareer_hh_Session',
        'width=800,height=700,menubar=no,toolbar=no,location=yes,status=no',
      );
    }
  }

  // eslint-disable-next-line max-lines-per-function
  async function handleCheckSession() {
    setStep('checking');
    setError(undefined);

    try {
      if (isTauriEnvironment()) {
        const nativeRes = await desktopNativeFetch({
          url: 'https://hh.ru/applicant/resumes',
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        });

        if (nativeRes && nativeRes.body) {
          if (
            nativeRes.body.includes('VPN мешает работе сайта') ||
            nativeRes.body.includes('vpn-cheeck')
          ) {
            setError(
              'hh.ru блокирует доступ через включённый VPN («VPN мешает работе сайта»). Отключите VPN для hh.ru либо загрузите резюме в формате PDF.',
            );
            setStep('session_open');
            return;
          }

          const isLoginPage =
            nativeRes.body.includes('account/login') ||
            nativeRes.body.includes('data-qa="account-login-page"');

          if (isLoginPage) {
            setError(
              'Сессия hh.ru ещё не активна. Пожалуйста, выполните вход в открывшемся окне hh.ru и повторите проверку.',
            );
            setStep('session_open');
            return;
          }

          const resumeList = parseHhResumesList(nativeRes.body);
          if (resumeList.length > 0) {
            const defaultParsed = await fetchFirstHhResumeDetail(resumeList[0].url);
            onConnectSuccess(resumeList, defaultParsed, resumeList[0].url);
            onClose();
            return;
          }
        }
      }

      setError(
        'Не удалось обнаружить активную сессию hh.ru. Убедитесь, что вы вошли в аккаунт соискателя в окне hh.ru, либо загрузите файл резюме в формате PDF.',
      );
      setStep('session_open');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось подключить hh.ru. Загрузите PDF резюме или повторите попытку.',
      );
      setStep('session_open');
    }
  }

  return (
    <div
      className="career-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hh-modal-title"
    >
      <div className="career-modal-card">
        <div className="career-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <GlobeHemisphereWest
              size={24}
              weight="bold"
              style={{ color: '#d6001c' }}
            />
            <h2 id="hh-modal-title">Подключение hh.ru</h2>
          </div>
          <button
            type="button"
            className="career-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="career-modal-body">
          <div className="career-modal-network-status">
            {probing ? (
              <span>Проверяем доступность hh.ru…</span>
            ) : isVpnSafe ? (
              <>
                <CheckCircle
                  size={18}
                  weight="fill"
                  style={{ color: '#22c55e' }}
                />
                <span>
                  Прямой доступ к hh.ru проверен в реальном времени (VPN не
                  мешает)
                </span>
              </>
            ) : (
              <>
                <WarningCircle
                  size={18}
                  weight="fill"
                  style={{ color: '#f59e0b' }}
                />
                <span>Возможны ограничения доступа со стороны hh.ru</span>
              </>
            )}
          </div>

          <p className="career-modal-intro">
            OpenQareer подключается к hh.ru через браузерную сессию соискателя на
            вашем устройстве и загружает список ваших резюме для выбора.
          </p>

          {step === 'idle' ? (
            <div style={{ padding: '16px 0' }}>
              <button
                type="button"
                className="career-primary-button"
                onClick={handleOpenSession}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  justifyContent: 'center',
                  padding: '12px 20px',
                }}
              >
                <ArrowSquareOut size={18} weight="bold" />
                <span>Открыть окно входа в hh.ru</span>
              </button>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '16px',
                margin: '12px 0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '8px',
                }}
              >
                <GlobeHemisphereWest
                  size={20}
                  weight="bold"
                  style={{ color: '#d6001c' }}
                />
                <strong style={{ color: '#ffffff' }}>
                  Окно сессии hh.ru открыто
                </strong>
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--career-text-dim, #94a3b8)',
                  margin: 0,
                  lineHeight: '1.4',
                }}
              >
                1. Выполните вход в ваш аккаунт соискателя на hh.ru в открывшемся
                окне.
                <br />
                2. После успешного входа нажмите кнопку ниже для загрузки
                списка резюме.
              </p>
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
            Закрыть
          </button>
          {step === 'session_open' || step === 'checking' ? (
            <button
              type="button"
              className="career-primary-button"
              onClick={() => void handleCheckSession()}
              disabled={step === 'checking'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WebDesktopCtaCallout() {
  return (
    <div className="career-web-desktop-cta">
      <div className="career-web-desktop-icon">
        <LockSimple size={28} weight="fill" />
      </div>
      <div className="career-web-desktop-content">
        <strong>
          Импорт профилей LinkedIn и hh.ru доступен в десктопном приложении
        </strong>
        <p>
          Для безопасного прямого подключения к hh.ru и защищённого
          туннелирования LinkedIn без риска блокировок используйте OpenQareer
          Desktop для macOS и Windows.
        </p>
        <div className="career-web-desktop-actions">
          <a
            href="https://openqareer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="career-primary-button"
            style={{
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>Скачать OpenQareer Desktop</span>
          </a>
        </div>
      </div>
    </div>
  );
}
