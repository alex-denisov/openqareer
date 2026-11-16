import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ComposerMenu } from './ComposerMenu';
import { fitComposerHeight } from './composerFit';
import { Icon } from './Icon';
import { useVoiceMode, type ComposerMode } from './useVoiceMode';

export interface ComposerProps {
  /** Скрытая подпись поля для экранного чтеца. */
  readonly label: string;
  readonly placeholder: string;
  readonly onSubmit: (text: string) => void;
  readonly busy?: boolean;
  /**
   * Запрос голосового ввода: отказ (reject) показывает «Нет доступа к микрофону».
   * Нет `onVoice` — меню способов ввода не показывается.
   */
  readonly onVoice?: () => Promise<void>;
}

function SendButton({ mode, busy }: { readonly mode: ComposerMode; readonly busy: boolean }) {
  return (
    <button
      className="cmp-send"
      type="submit"
      aria-label={mode === 'voice' ? 'Надиктовать' : 'Отправить'}
      aria-busy={busy || undefined}
    >
      <span className="cmp-dot">
        <Icon name="send" className="cmp-i-send" />
        <Icon name="mic" className="cmp-i-mic" />
      </span>
    </button>
  );
}

function MicDenied({ shown }: { readonly shown: boolean }) {
  return (
    <div className="cmp-toast-wrap" role="status">
      {shown ? (
        <p className="cmp-toast">
          <Icon name="micoff" />
          Нет доступа к микрофону
        </p>
      ) : null}
    </div>
  );
}

/** Enter отправляет, Shift+Enter — перенос строки. */
function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  send();
}

export function Composer({ label, placeholder, onSubmit, busy = false, onVoice }: ComposerProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const { mode, denied, choose, record } = useVoiceMode(onVoice);
  useEffect(() => {
    if (area.current) fitComposerHeight(area.current);
  }, [text]);
  function send(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (busy) return;
    if (mode === 'voice' && !value) return record();
    if (!value) return;
    onSubmit(value);
    setText('');
  }

  return (
    <form
      className={text ? 'compose cmp has-text' : 'compose cmp'}
      data-mode={mode}
      onSubmit={send}
    >
      <label className="vh" htmlFor={id}>
        {label}
      </label>
      <div className="cmp-row">
        <textarea
          ref={area}
          className="cmp-in"
          id={id}
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, send)}
        />
        <SendButton mode={mode} busy={busy} />
        {onVoice ? (
          <ComposerMenu id={`${id}-menu`} mode={mode} onChoose={(next) => void choose(next)} />
        ) : null}
      </div>
      <MicDenied shown={denied} />
    </form>
  );
}
