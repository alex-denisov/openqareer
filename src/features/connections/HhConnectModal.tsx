import { useEffect, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { isTauriEnvironment, probeNetworkStatus } from '../../services/desktop/desktopBridge';
import {
  parseHhResumeHtml,
  parseHhResumesList,
} from '../../services/connectors/hhResumeParser';
import type { ParsedResume } from '../workspace/resumeParser';
import { ImportModalShell } from './ImportModalShell';
import { PlatformLogo } from './PlatformLogo';
import {
  looksLikeHhLoginPage,
  looksLikeHhVpnBlock,
  openPlatformSession,
  readSessionPage,
  type ConnectorSessionStep,
} from './connectorSession';

const HH_RESUME_LIST_URL = 'https://hh.ru/applicant/resumes';

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
export function HhConnectModal({
  isOpen,
  onClose,
  onConnectSuccess,
}: HhConnectModalProps) {
  const [step, setStep] = useState<ConnectorSessionStep>('idle');
  const [error, setError] = useState<string>();
  const [probing, setProbing] = useState(false);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setStep('idle');
    setError(undefined);
    setProbing(true);
    void probeNetworkStatus()
      .then((status) => setReachable(status.hh.accessible))
      .catch(() => setReachable(true))
      .finally(() => setProbing(false));
  }, [isOpen]);

  async function checkSession() {
    setStep('checking');
    setError(undefined);
    try {
      if (isTauriEnvironment()) {
        const page = await readSessionPage(HH_RESUME_LIST_URL);
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
            onConnectSuccess(
              resumes,
              await readFirstResume(resumes[0].url),
              resumes[0].url,
            );
            onClose();
            return;
          }
        }
      }
      setError(
        'Активную сессию hh.ru найти не удалось. Войдите в аккаунт соискателя в окне hh.ru или загрузите PDF резюме.',
      );
      setStep('session_open');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Подключить hh.ru не удалось. Загрузите PDF резюме или повторите попытку.',
      );
      setStep('session_open');
    }
  }

  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="hh-modal-title"
      title="Подключение hh.ru"
      icon={<PlatformLogo platform="hh" size={26} />}
    >
      <div className="career-modal-body">
        <p className="career-modal-network-status">
          {probing ? (
            <span>Проверяем доступность hh.ru…</span>
          ) : reachable ? (
            <>
              <CheckCircle size={18} weight="fill" />
              <span>Прямой доступ к hh.ru сейчас работает</span>
            </>
          ) : (
            <>
              <WarningCircle size={18} weight="fill" />
              <span>hh.ru может ограничивать доступ с текущего маршрута</span>
            </>
          )}
        </p>

        <p className="career-modal-intro">
          Подключение читает список ваших резюме через вашу собственную сессию
          соискателя. Мы ничего не публикуем и не откликаемся от вашего имени.
        </p>

        {step === 'idle' ? (
          <button
            type="button"
            className="career-primary-button career-modal-wide-action"
            onClick={() => {
              setError(undefined);
              setStep('session_open');
              openPlatformSession(
                'https://hh.ru/account/login',
                'OpenQareer_hh_Session',
              );
            }}
          >
            <ArrowSquareOut size={18} weight="bold" />
            <span>Открыть окно входа в hh.ru</span>
          </button>
        ) : (
          <div className="career-modal-steps">
            <strong>
              <PlatformLogo platform="hh" size={20} />
              Окно сессии hh.ru открыто
            </strong>
            <ol>
              <li>Войдите в аккаунт соискателя в открывшемся окне.</li>
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
        {step === 'idle' ? null : (
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
    const page = await readSessionPage(url);
    return page.body ? parseHhResumeHtml(page.body, url) : undefined;
  } catch {
    // The list alone is already useful; the candidate picks a resume next.
    return undefined;
  }
}
