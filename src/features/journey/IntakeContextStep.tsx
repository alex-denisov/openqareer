import { Check } from '@phosphor-icons/react';
import type {
  SearchUrgency,
  WorkspaceMarket,
} from '../workspace/workspaceStorage';

const CONDITION_OPTIONS = [
  'Только удалённо',
  'Готов к гибриду',
  'Рассматриваю релокацию',
  'Нужна визовая поддержка',
] as const;

export interface IntakeContextValues {
  readonly currentSituation: string;
  readonly targetDirection: string;
  readonly market: WorkspaceMarket;
  readonly urgency: SearchUrgency;
  readonly conditions: readonly string[];
  readonly otherConstraint: string;
}

export interface IntakeContextStepProps extends IntakeContextValues {
  /** True when a document already carries the candidate's situation. */
  readonly optional: boolean;
  readonly onChange: (patch: Partial<IntakeContextValues>) => void;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
export function IntakeContextStep(props: IntakeContextStepProps) {
  const { onChange } = props;
  return (
    <div className="career-context-form">
      <label className="career-field-wide">
        <span>
          Что происходит сейчас?
          {props.optional ? <em> — по желанию</em> : null}
        </span>
        <textarea
          value={props.currentSituation}
          onChange={(event) => onChange({ currentSituation: event.target.value })}
          placeholder="Например: давно не получаю приглашений, хочу сменить рынок, возвращаюсь после перерыва или не понимаю свой уровень."
          rows={3}
        />
        <small>
          {props.optional
            ? 'Резюме уже прочитано — здесь можно добавить то, чего в нём нет.'
            : 'Это станет первым контекстом для карьерного эксперта.'}
        </small>
      </label>

      <label>
        <span>Какая роль интересует?</span>
        <input
          value={props.targetDirection}
          onChange={(event) => onChange({ targetDirection: event.target.value })}
          placeholder="Можно оставить пустым"
        />
      </label>

      <fieldset>
        <legend>Где рассматриваете работу?</legend>
        <div className="career-segmented-control">
          {(
            [
              ['ru', 'Россия'],
              ['international', 'Международный рынок'],
            ] as Array<[WorkspaceMarket, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={props.market === value ? 'is-selected' : ''}
              aria-pressed={props.market === value}
              onClick={() => onChange({ market: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="career-field-wide">
        <legend>Что важно учесть?</legend>
        <div className="career-chip-picker">
          {CONDITION_OPTIONS.map((condition) => {
            const selected = props.conditions.includes(condition);
            return (
              <button
                key={condition}
                type="button"
                className={selected ? 'is-selected' : ''}
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    conditions: selected
                      ? props.conditions.filter((item) => item !== condition)
                      : [...props.conditions, condition],
                  })
                }
              >
                {selected ? <Check size={15} weight="bold" /> : null}
                {condition}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label>
        <span>Другие ограничения</span>
        <input
          value={props.otherConstraint}
          onChange={(event) => onChange({ otherConstraint: event.target.value })}
          placeholder="Язык, график, доход, отрасль…"
        />
      </label>

      <fieldset>
        <legend>Темп поиска</legend>
        <div className="career-segmented-control">
          {(
            [
              ['exploring', 'Изучаю'],
              ['active', 'Ищу активно'],
              ['urgent', 'Нужно быстро'],
            ] as Array<[SearchUrgency, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={props.urgency === value ? 'is-selected' : ''}
              aria-pressed={props.urgency === value}
              onClick={() => onChange({ urgency: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
