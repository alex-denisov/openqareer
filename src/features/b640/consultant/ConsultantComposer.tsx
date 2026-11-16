import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ComposerMenu } from '../kit/ComposerMenu';
import { fitComposerHeight } from '../kit/composerFit';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import type { ConsultantLimit } from './model';
import { useDictation } from './useDictation';

export interface ConsultantComposerProps {
  readonly onSubmit: (text: string) => void;
  /** Ответ ещё пишется или не пришёл: новая отправка ждёт, набранное остаётся в поле. */
  readonly busy: boolean;
  /** Сообщения по тарифу закончились: ввод закрыт, строка ведёт к тарифам. */
  readonly limit: ConsultantLimit | null;
  readonly tariffsPath: string;
}

type Mode = 'text' | 'voice';

function LimitLine({ limit, tariffsPath }: { limit: ConsultantLimit; tariffsPath: string }) {
  return (
    <p className="cmp-line" role="status">
      <span className="cmp-line-t">
        Лимит сообщений исчерпан
        {limit.resetLabel ? (
          <>
            {' · '}
            <span className="cmp-line-d">
              обновится <span className="num">{limit.resetLabel}</span>
            </span>
          </>
        ) : null}
      </span>
      {limit.upgradePlan ? (
        <Link className="cmp-line-a" to={tariffsPath}>
          Перейти на {limit.upgradePlan}
        </Link>
      ) : null}
    </p>
  );
}

function sendLabel(mode: Mode, recording: boolean): string {
  if (recording) return 'Остановить диктовку';
  return mode === 'voice' ? 'Надиктовать' : 'Отправить';
}

interface SendButtonProps {
  readonly mode: Mode;
  readonly recording: boolean;
  readonly busy: boolean;
  readonly off: boolean;
}

function SendButton({ mode, recording, busy, off }: SendButtonProps) {
  return (
    <button
      className={recording ? 'cmp-send is-rec' : 'cmp-send'}
      type="submit"
      aria-label={sendLabel(mode, recording)}
      aria-pressed={recording ? true : undefined}
      aria-busy={busy || undefined}
      disabled={off}
    >
      <span className="cmp-dot">
        <Icon name="send" className="cmp-i-send" />
        <Icon name="mic" className="cmp-i-mic" />
      </span>
    </button>
  );
}

/** Закрытый ввод (K3): способ ввода виден, но недоступен. */
function ModeOff() {
  return (
    <span className="cmp-mode">
      <button className="cmp-caret" type="button" aria-label="Способ ввода: текстом" disabled>
        <Icon name="down" />
      </button>
    </span>
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

/** Высота поля идёт за текстом (до 13 строк). */
function useFitHeight(text: string) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (area.current) fitComposerHeight(area.current);
  }, [text]);
  return area;
}

function formClass(hasText: boolean, off: boolean): string {
  return ['compose', 'cmp', hasText ? 'has-text' : '', off ? 'is-off' : ''].filter(Boolean).join(' ');
}

/**
 * Панель ввода консультанта по макету K1: текст или диктовка (K1b), предел сообщений (K3),
 * «Нет доступа к микрофону» (K3b). Поле очищается, только когда вопрос ушёл в ленту.
 */
export function ConsultantComposer({ onSubmit, busy, limit, tariffsPath }: ConsultantComposerProps) {
  const id = useId();
  const [text, setText] = useState('');
  const area = useFitHeight(text);
  const [mode, setMode] = useState<Mode>('text');
  const voice = useDictation(setText, () => setMode('text'));
  const off = limit !== null;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (off || voice.settling) return;
    if (voice.recording) return voice.stop();
    const value = text.trim();
    if (mode === 'voice' && !value) return voice.start(text);
    if (!value || busy) return;
    onSubmit(value);
    setText('');
  }
  function choose(next: Mode) {
    if (voice.recording) voice.stop();
    setMode(next);
  }

  return (
    <form className={formClass(Boolean(text), off)} data-mode={mode} onSubmit={submit}>
      {limit ? <LimitLine limit={limit} tariffsPath={tariffsPath} /> : null}
      <label className="vh" htmlFor={id}>
        Ваш вопрос консультанту
      </label>
      <div className="cmp-row">
        <textarea
          ref={area}
          className="cmp-in"
          id={id}
          rows={1}
          placeholder="Спросите своими словами"
          value={text}
          disabled={off}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, submit)}
        />
        <SendButton mode={mode} recording={voice.recording} busy={busy} off={off} />
        {voice.supported && !off ? (
          <ComposerMenu id={`${id}-menu`} mode={mode} onChoose={choose} />
        ) : null}
        {voice.supported && off ? <ModeOff /> : null}
      </div>
      <MicDenied shown={voice.denied} />
    </form>
  );
}
