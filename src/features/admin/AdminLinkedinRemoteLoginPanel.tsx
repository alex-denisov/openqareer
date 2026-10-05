import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLineRight,
  Backspace,
  Browser,
  KeyReturn,
  PaperPlaneTilt,
  X,
} from '@phosphor-icons/react';
import type { RemoteLoginFrame, RemoteLoginInput, RemoteLoginKey } from './linkedinRemoteLoginApi';
import { frameToPagePoint, remoteLoginStatusText } from './remoteLoginModel';
import { useRemoteLoginActions } from './useRemoteLoginActions';
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

interface ScreenProps {
  readonly frame: RemoteLoginFrame | undefined;
  readonly ended: boolean;
  readonly onPoint: (input: RemoteLoginInput) => void;
}

function RemoteLoginScreen({ frame, ended, onPoint }: ScreenProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  function onClick(event: React.MouseEvent) {
    const image = imageRef.current;
    if (!image || !frame || ended) return;
    const point = frameToPagePoint(event, image.getBoundingClientRect(), frame);
    if (point) onPoint({ type: 'click', ...point });
  }

  return (
    <button
      className="admin-remote-login__screen"
      type="button"
      disabled={ended || !frame?.imageBase64}
      aria-label="Экран браузера сервера: нажмите, чтобы кликнуть в этом месте страницы"
      onClick={onClick}
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
  );
}

function RemoteLoginControls({ onSend }: { readonly onSend: (input: RemoteLoginInput) => void }) {
  const [text, setText] = useState('');
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = text;
    if (!value) return;
    setText('');
    onSend({ type: 'text', text: value });
  }

  return (
    <form className="admin-remote-login__controls" onSubmit={submit}>
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
          onClick={() => onSend({ type: 'key', key })}
        >
          <Icon size={18} aria-hidden="true" /> {key}
        </button>
      ))}
    </form>
  );
}

export function AdminLinkedinRemoteLoginPanel({
  accountId,
  accountLabel,
  loginId,
  onClose,
}: PanelProps) {
  const titleId = useId();
  const { frame, error: frameError, ended } = useRemoteLoginFrame(accountId, loginId);
  const { close, send, inputError } = useRemoteLoginActions({ accountId, loginId, ended, onClose });
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
        <p
          className="admin-remote-login__status"
          role="status"
          data-state={frame?.state ?? 'pending'}
        >
          {remoteLoginStatusText(frame)}
        </p>
        {errorText ? (
          <p className="admin-remote-login__error" role="alert">
            {errorText}
          </p>
        ) : null}
        <RemoteLoginScreen frame={frame} ended={ended} onPoint={(input) => void send(input)} />
        {ended ? null : <RemoteLoginControls onSend={(input) => void send(input)} />}
      </div>
    </div>
  );
}
