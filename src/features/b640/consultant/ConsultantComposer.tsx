import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ComposerMenu } from '../kit/ComposerMenu';
import { fitComposerHeight } from '../kit/composerFit';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import type { ConsultantLimit } from './model';
import { useDictation } from './useDictation';

export interface ConsultantComposerProps {
  readonly onSubmit: (text: string) => void;
  /** Ответ ещё пишется: новая отправка ждёт. */
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

/**
 * Панель ввода консультанта по макету K1: текст или диктовка, предел сообщений (K3),
 * «Нет доступа к микрофону» (K3b). Набранное не теряется при сбое отправки: поле
 * очищается только после того, как вопрос ушёл в ленту.
 */
export function ConsultantComposer({ onSubmit, busy, limit, tariffsPath }: ConsultantComposerProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const voice = useDictation(setText, () => setMode('text'));
  const off = limit !== null;

  useEffect(() => {
    if (area.current) fitComposerHeight(area.current);
  }, [text]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (off) return;
    if (voice.recording) return voice.stop();
    const value = text.trim();
    if (mode === 'voice' && !value) return voice.start(text);
    if (!value || busy) return;
    onSubmit(value);
    setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  function choose(next: Mode) {
    if (voice.recording) voice.stop();
    setMode(next);
  }

  const className = ['compose', 'cmp', text ? 'has-text' : '', off ? 'is-off' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <form className={className} data-mode={mode} onSubmit={submit}>
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
          onKeyDown={onKeyDown}
        />
        <button
          className={voice.recording ? 'cmp-send is-rec' : 'cmp-send'}
          type="submit"
          aria-label={sendLabel(mode, voice.recording)}
          aria-pressed={voice.recording ? true : undefined}
          aria-busy={busy || undefined}
          disabled={off}
        >
          <span className="cmp-dot">
            <Icon name="send" className="cmp-i-send" />
            <Icon name="mic" className="cmp-i-mic" />
          </span>
        </button>
        {voice.supported && !off ? (
          <ComposerMenu id={`${id}-menu`} mode={mode} onChoose={choose} />
        ) : null}
        {voice.supported && off ? (
          <span className="cmp-mode">
            <button className="cmp-caret" type="button" aria-label="Способ ввода: текстом" disabled>
              <Icon name="down" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="cmp-toast-wrap" role="status">
        {voice.denied ? (
          <p className="cmp-toast">
            <Icon name="micoff" />
            Нет доступа к микрофону
          </p>
        ) : null}
      </div>
    </form>
  );
}
