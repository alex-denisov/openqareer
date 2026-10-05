import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLineRight, Backspace, Browser, KeyReturn, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  closeRemoteLogin,
  sendRemoteLoginInput,
  type RemoteLoginInput,
  type RemoteLoginKey,
} from './linkedinRemoteLoginApi';
import { frameToPagePoint, remoteLoginErrorText, remoteLoginStatusText } from './remoteLoginModel';
import { useRemoteLoginFrame } from './useRemoteLoginFrame';
import './admin-linkedin-remote-login.css';

interface PanelProps {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly loginId: string;
  /** `error` передаётся, если закрыть окно на сервере не удалось. */
  readonly onClose: (error?: string) => void;
}

const KEYS: ReadonlyArray<{ key: RemoteLoginKey; Icon: typeof KeyReturn }> = [
  { key: 'Enter', Icon: KeyReturn },
  { key: 'Tab', Icon: ArrowLineRight },
  { key: 'Backspace', Icon: Backspace },
];

export function AdminLinkedinRemoteLoginPanel({
  accountId,
  accountLabel,
  loginId,
  onClose,
}: PanelProps) {
  const titleId = useId();
  const { frame, error: frameError, ended } = useRemoteLoginFrame(accountId, loginId);
  const [inputError, setInputError] = useState<string>();
  const [text, setText] = useState('');
  const imageRef = useRef<HTMLImageElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);
  const aliveRef = useRef(true);

  const close = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    let failure: string | undefined;
    if (!ended) {
      try {
        await closeRemoteLogin(accountId, loginId);
      } catch (reason: unknown) {
        failure = remoteLoginErrorText(reason);
      }
    }
    onClose(failure);
  }, [accountId, loginId, ended, onClose]);

  useEscapeLayer(() => void close());

  useEffect(() => {
    aliveRef.current = true;
    textRef.current?.focus();
    return () => {
      aliveRef.current = false;
      // Отложено, чтобы повторная установка в StrictMode не закрывала живое окно.
      setTimeout(() => {
        if (aliveRef.current || finishedRef.current) return;
        finishedRef.current = true;
        void closeRemoteLogin(accountId, loginId).catch(() => undefined);
      }, 0);
    };
  }, [accountId, loginId]);

  const send = useCallback(
    async (input: RemoteLoginInput) => {
      setInputError(undefined);
      try {
        await sendRemoteLoginInput(accountId, loginId, input);
      } catch (reason: unknown) {
        setInputError(remoteLoginErrorText(reason));
      }
    },
    [accountId, loginId],
  );

  function onImageClick(event: React.MouseEvent) {
    const image = imageRef.current;
    if (!image || !frame || ended) return;
    const rect = image.getBoundingClientRect();
    const point = frameToPagePoint(event, rect, frame);
    if (point) void send({ type: 'click', ...point });
  }

  function submitText(event: React.FormEvent) {
    event.preventDefault();
    const value = text;
    if (!value || ended) return;
    setText('');
    void send({ type: 'text', text: value });
  }

  const errorText = inputError ?? frameError;
  return (
    <div className="admin-remote-login__backdrop">
      <div className="admin-remote-login" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="admin-remote-login__head">
          <h3 id={titleId}>
            <Browser size={20} aria-hidden="true" /> Вход в браузере сервера · {accountLabel}
          </h3>
          <button className="admin-remote-login__btn" type="button" onClick={() => void close()}>
            <X size={18} aria-hidden="true" /> Закрыть
          </button>
        </header>
        <p className="admin-remote-login__status" role="status" data-state={frame?.state ?? 'pending'}>
          {remoteLoginStatusText(frame)}
        </p>
        {errorText ? (
          <p className="admin-remote-login__error" role="alert">
            {errorText}
          </p>
        ) : null}
        <button
          className="admin-remote-login__screen"
          type="button"
          disabled={ended || !frame?.imageBase64}
          aria-label="Экран браузера сервера: нажмите, чтобы кликнуть в этом месте страницы"
          onClick={onImageClick}
        >
          {frame?.imageBase64 ? (
            <img
              ref={imageRef}
              src={`data:image/jpeg;base64,${frame.imageBase64}`}
              alt="Экран браузера на сервере"
              draggable={false}
            />
          ) : (
            <span>Кадр ещё не получен</span>
          )}
        </button>
        {ended ? null : (
          <form className="admin-remote-login__controls" onSubmit={submitText}>
            <label className="admin-remote-login__field">
              <span>Текст для страницы</span>
              <input
                ref={textRef}
                type="text"
                value={text}
                maxLength={256}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button className="admin-remote-login__btn is-primary" type="submit" disabled={!text}>
              <PaperPlaneTilt size={18} aria-hidden="true" /> Отправить
            </button>
            {KEYS.map(({ key, Icon }) => (
              <button
                key={key}
                className="admin-remote-login__btn"
                type="button"
                onClick={() => void send({ type: 'key', key })}
              >
                <Icon size={18} aria-hidden="true" /> {key}
              </button>
            ))}
          </form>
        )}
      </div>
    </div>
  );
}
