import { useId } from 'react';
import type { QuestionnaireQuestion } from '../../../../shared/applicationQuestionnaire';
import { choiceValues, toggleChoice } from './model/choiceModel';

export interface ChoiceFieldProps {
  /** Id первого варианта: к нему ведёт кнопка «Ответьте на обязательные». */
  readonly fieldId: string;
  readonly question: QuestionnaireQuestion;
  readonly value: string;
  readonly onPick: (next: string) => void;
}

/** B703: вопрос с выбором — переключатели (один ответ) или отметки (несколько), а не поле. */
export function ChoiceField({ fieldId, question, value, onPick }: ChoiceFieldProps) {
  const name = useId();
  const picked = choiceValues(value);
  const options = question.options ?? [];
  // Сохранённый ответ, которого уже нет среди вариантов, не теряется молча.
  const shown = [...options, ...picked.filter((item) => !options.includes(item))];
  return (
    <ul
      className="vt-opts"
      role={question.multiple ? 'group' : 'radiogroup'}
      aria-label={`Ваш ответ: ${question.text}`}
    >
      {shown.map((option, index) => (
        <li key={option}>
          <label className="vt-opt">
            <input
              id={index === 0 ? fieldId : undefined}
              type={question.multiple ? 'checkbox' : 'radio'}
              name={name}
              checked={picked.includes(option)}
              onChange={() => onPick(toggleChoice(question, value, option))}
            />
            <span className="vt-opt-t">{option}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
