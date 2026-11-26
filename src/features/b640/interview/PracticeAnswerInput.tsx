import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterviewAnswerMode } from '../../interview/interviewSimulatorApi';
import { Icon, StatusLine } from '../kit';
import type { VoiceInput } from '../voice/useVoiceInput';

export const ANSWER_MAX = 4000;

export interface InputProps {
  readonly text: string;
  readonly empty: boolean;
  readonly onText: (text: string) => void;
}

export function TextInput(props: InputProps) {
  return (
    <div className="field">
      <textarea
        className="letter full sd-live"
        aria-label="Ваш ответ"
        value={props.text}
        maxLength={ANSWER_MAX}
        aria-invalid={props.empty ? true : undefined}
        aria-describedby={props.empty ? 'sd-ans-err' : undefined}
        onChange={(event) => props.onText(event.currentTarget.value)}
      />
      {props.empty ? (
        <small className="is-err" id="sd-ans-err">
          <Icon name="warn" />
          Напишите ответ
        </small>
      ) : null}
    </div>
  );
}

/**
 * Голосом: в браузере расшифровка по мере речи, в .app текст приходит после «Стоп».
 * Без микрофона или после конца записи — поле ответа с тем, что есть.
 */
export function VoiceAnswer(props: InputProps & { readonly voice: VoiceInput }) {
  const { voice } = props;
  const listening = voice.supported && voice.failure === null;
  const { start } = voice;
  const [started, setStarted] = useState(false);
  const first = useRef(props.text);
  useEffect(() => {
    if (!listening || started) return;
    setStarted(true);
    start(first.current);
  }, [listening, started, start]);
  const live = !started || voice.starting || voice.recording || voice.settling;
  if (!listening || !live) {
    return (
      <>
        <TextInput {...props} />
        {voice.failure === 'mic' ? <StatusLine state="err" text="Нет доступа к микрофону" /> : null}
        {voice.failure === 'speech' ? (
          <StatusLine state="err" text="Не удалось распознать запись" />
        ) : null}
      </>
    );
  }
  return (
    <div
      className="letter full sd-live"
      aria-live="polite"
      aria-label="Ваш ответ, расшифровка по мере речи"
    >
      <div>
        {props.text}
        {voice.recording ? <span className="sd-caret" aria-hidden="true" /> : null}
        {voice.settling ? ' Расшифровываем…' : null}
      </div>
    </div>
  );
}

/** «Голосом / Текстом»: выбор кандидата, а без голоса — только текст. */
export function answerModeOf(
  chosen: InterviewAnswerMode | null,
  supported: boolean,
): InterviewAnswerMode {
  if (!supported) return 'text';
  return chosen ?? 'voice';
}

/** «Закончить и разобрать» во время записи: сначала «Стоп», разбор — когда текст пришёл. */
export function useFinishAfterVoice(
  voice: VoiceInput | null,
  finish: () => void,
): { readonly waiting: boolean; readonly request: () => void } {
  const [waiting, setWaiting] = useState(false);
  const active = voice !== null && (voice.recording || voice.settling);
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);
  useEffect(() => {
    if (!waiting || active) return;
    setWaiting(false);
    finishRef.current();
  }, [waiting, active]);
  const stop = voice?.stop;
  const request = useCallback(() => {
    if (!active) {
      finishRef.current();
      return;
    }
    if (voice?.recording) stop?.();
    setWaiting(true);
  }, [active, stop, voice?.recording]);
  return { waiting, request };
}
