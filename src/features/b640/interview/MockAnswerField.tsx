import type { VoiceInput } from '../voice/useVoiceInput';
import { Icon } from '../kit';

export interface MockAnswerFieldProps {
  readonly text: string;
  readonly readOnly: boolean;
  readonly empty: boolean;
  readonly dictation: VoiceInput;
  readonly onChange: (text: string) => void;
}

function MicButton({ text, dictation }: { readonly text: string; readonly dictation: VoiceInput }) {
  if (dictation.failure === 'mic') {
    return (
      <>
        <button
          className="icon-btn mic-btn is-off"
          type="button"
          aria-label="Нет доступа к микрофону"
          aria-disabled="true"
          aria-describedby="mi-mic-off-tip"
        >
          <Icon name="micoff" />
        </button>
        <span className="mic-off-tip" id="mi-mic-off-tip" role="tooltip">
          Нет доступа к микрофону
        </span>
      </>
    );
  }
  const recording = dictation.recording || dictation.settling;
  return (
    <button
      className={recording ? 'icon-btn mic-btn is-rec' : 'icon-btn mic-btn'}
      type="button"
      aria-label={recording ? 'Остановить запись' : 'Надиктовать'}
      onClick={() => (recording ? dictation.stop() : dictation.start(text))}
    >
      <Icon name="mic" />
    </button>
  );
}

/** Поле ответа I2: текстом или голосом — сказанное дописывается к написанному. */
export function MockAnswerField(props: MockAnswerFieldProps) {
  const { dictation } = props;
  const voice = dictation.supported && !props.readOnly;
  return (
    <div className="field mi-ans">
      <label htmlFor="mi-ans">Ваш ответ</label>
      <div className="fld-mic mi-fld">
        <textarea
          id="mi-ans"
          value={props.text}
          readOnly={props.readOnly}
          placeholder="Напишите ответ своими словами"
          aria-invalid={props.empty ? true : undefined}
          aria-describedby={props.empty ? 'mi-ans-err' : undefined}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        {voice ? <MicButton text={props.text} dictation={dictation} /> : null}
      </div>
      {voice && dictation.failure === 'speech' ? (
        <p className="li-copied c6-res mi-rec-err is-on" role="alert">
          <Icon name="warn" />
          Не удалось распознать запись
          <button className="row-act" type="button" onClick={() => dictation.start(props.text)}>
            <Icon name="refresh" />
            Повторить
          </button>
        </p>
      ) : null}
      {props.empty ? (
        <small className="is-err" id="mi-ans-err">
          <Icon name="warn" />
          Напишите ответ
        </small>
      ) : null}
    </div>
  );
}
