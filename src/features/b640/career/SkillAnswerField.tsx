import { useEffect, useId } from 'react';
import { useDictation } from '../consultant/useDictation';
import { Icon, InfoTip, useToast } from '../kit';

const TIP = 'Ответ остаётся у вас — в профиль попадёт только итог.';

export interface SkillAnswerFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

/** Поле ответа с диктовкой: сказанное дописывается к тексту. */
export function SkillAnswerField({ value, onChange, disabled }: SkillAnswerFieldProps) {
  const id = useId();
  const dictation = useDictation(onChange);
  const toast = useToast();
  useEffect(() => {
    if (dictation.denied) toast.show({ text: 'Нет доступа к микрофону' });
  }, [dictation.denied, toast]);
  const recording = dictation.recording || dictation.settling;
  return (
    <div className="field">
      <label htmlFor={id}>
        Ваш ответ
        <InfoTip label="Пояснение" text={TIP} />
      </label>
      <div className="fld-mic">
        <textarea
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {dictation.supported ? (
          <button
            className={recording ? 'icon-btn mic-btn is-rec' : 'icon-btn mic-btn'}
            type="button"
            aria-label={recording ? 'Остановить запись' : 'Надиктовать'}
            onClick={() => (recording ? dictation.stop() : dictation.start(value))}
          >
            <Icon name="mic" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
