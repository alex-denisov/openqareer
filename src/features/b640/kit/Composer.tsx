import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ComposerMenu } from './ComposerMenu';
import { fitComposerHeight } from './composerFit';
import { Icon } from './Icon';
import { useVoiceMode, type ComposerMode } from './useVoiceMode';

/** Диктовка в поле ввода: её ведёт владелец, панель показывает состояние и зовёт начало и конец. */
export interface ComposerDictation {
  /** Браузер умеет распознавать речь: иначе способ «Голосом» не предлагается. */
  readonly supported: boolean;
  readonly recording: boolean;
  /** Запись остановлена, последние слова ещё дописываются в поле. */
  readonly settling: boolean;
  /** Показать «Нет доступа к микрофону». */
  readonly denied: boolean;
  /** Начать запись: сказанное дописывается к тексту поля (нужен управляемый `text`). */
  readonly start: (currentText: string) => void;
  readonly stop: () => void;
}

export interface ComposerProps {
  /** Скрытая подпись поля для экранного чтеца. */
  readonly label: string;
  readonly placeholder: string;
  readonly onSubmit: (text: string) => void;
  /** Отправка ждёт; набранное остаётся в поле. */
  readonly busy?: boolean;
  /**
   * Запрос голосового ввода: отказ (reject) показывает «Нет доступа к микрофону».
   * Нет `onVoice` и `dictation` — меню способов ввода не показывается.
   */
  readonly onVoice?: () => Promise<void>;
  /** Текст ведёт владелец (диктовка, возврат текста после сбоя); вместе с `onText`. */
  readonly text?: string;
  readonly onText?: (text: string) => void;
  /** Ввод закрыт: содержимое строки над полем (`p.cmp-line`), поле и отправка недоступны. */
  readonly closed?: ReactNode;
  readonly dictation?: ComposerDictation;
}

function sendLabel(mode: ComposerMode, recording: boolean): string {
  if (recording) return 'Остановить диктовку';
  return mode === 'voice' ? 'Надиктовать' : 'Отправить';
}

interface SendButtonProps {
  readonly mode: ComposerMode;
  readonly busy: boolean;
  readonly recording: boolean;
  readonly off: boolean;
}

function SendButton({ mode, busy, recording, off }: SendButtonProps) {
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

/** Закрытый ввод: способ ввода виден, но недоступен. */
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

/** Текст поля: свой или владельца; высота поля идёт за текстом (до 13 строк). */
function useComposerText(text: string | undefined, onText: ((text: string) => void) | undefined) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [own, setOwn] = useState('');
  const value = text ?? own;
  useEffect(() => {
    if (area.current) fitComposerHeight(area.current);
  }, [value]);
  return { area, value, setValue: text === undefined ? setOwn : (onText ?? setOwn) };
}

/** Способ ввода: при диктовке его ведёт панель, без неё — запрос `onVoice`. */
function useComposerMode(onVoice: ComposerProps['onVoice'], dictation?: ComposerDictation) {
  const asked = useVoiceMode(onVoice);
  const [picked, setPicked] = useState<ComposerMode>('text');
  if (!dictation) return { ...asked, hasMenu: Boolean(onVoice) };
  // Сбой диктовки возвращает к тексту.
  if (dictation.denied && picked === 'voice') setPicked('text');
  const choose = (next: ComposerMode) => {
    if (dictation.recording) dictation.stop();
    setPicked(next);
  };
  const record = () => undefined;
  return { mode: picked, denied: dictation.denied, choose, record, hasMenu: dictation.supported };
}

function formClass(hasText: boolean, off: boolean): string {
  return ['compose', 'cmp', hasText ? 'has-text' : '', off ? 'is-off' : ''].filter(Boolean).join(' ');
}

/**
 * Панель ввода (макет K1): текст или голос, закрытый ввод со строкой над полем (K3),
 * состояние записи (K1b), «Нет доступа к микрофону» (K3b).
 */
export function Composer(props: ComposerProps) {
  const { label, placeholder, onSubmit, busy = false, onVoice, closed, dictation } = props;
  const id = useId();
  const { area, value, setValue } = useComposerText(props.text, props.onText);
  const { mode, denied, choose, record, hasMenu } = useComposerMode(onVoice, dictation);
  const off = closed !== undefined && closed !== null && closed !== false;
  const recording = dictation?.recording ?? false;

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (off || dictation?.settling) return;
    if (recording) return dictation?.stop();
    const text = value.trim();
    if (busy) return;
    if (mode === 'voice' && !text) return dictation ? dictation.start(value) : record();
    if (!text) return;
    onSubmit(text);
    setValue('');
  }

  return (
    <form className={formClass(Boolean(value), off)} data-mode={mode} onSubmit={send}>
      {off ? (
        <p className="cmp-line" role="status">
          {closed}
        </p>
      ) : null}
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
          value={value}
          disabled={off}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => submitOnEnter(event, send)}
        />
        <SendButton mode={mode} busy={busy} recording={recording} off={off} />
        {hasMenu && !off ? (
          <ComposerMenu id={`${id}-menu`} mode={mode} onChoose={(next) => void choose(next)} />
        ) : null}
        {hasMenu && off ? <ModeOff /> : null}
      </div>
      <MicDenied shown={denied} />
    </form>
  );
}
