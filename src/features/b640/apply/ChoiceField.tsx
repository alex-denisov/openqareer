import { useId, useState } from 'react';
import type { QuestionnaireQuestion } from '../../../../shared/applicationQuestionnaire';
import { Button } from '../kit';
import { choiceValues, toggleChoice, visibleOptions } from './model/choiceModel';

export interface ChoiceFieldProps {
  /** Id первого варианта, у длинного списка — поля поиска: к нему ведёт кнопка «Ответьте на обязательные». */
  readonly fieldId: string;
  readonly question: QuestionnaireQuestion;
  readonly value: string;
  readonly onPick: (next: string) => void;
}

/** Список длиннее страницы получает поиск и «Показать ещё». */
const PAGE = 20;

interface OptionListProps extends Omit<ChoiceFieldProps, 'fieldId'> {
  readonly fieldId: string | undefined;
  readonly picked: readonly string[];
  readonly shown: readonly string[];
}

/** B703: переключатели (один ответ) или отметки (несколько). */
function OptionList({ fieldId, question, value, onPick, picked, shown }: OptionListProps) {
  const name = useId();
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

/** Вопрос с выбором: короткий список целиком, длинный — с поиском и страницами. */
export function ChoiceField({ fieldId, question, value, onPick }: ChoiceFieldProps) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const picked = choiceValues(value);
  const options = question.options ?? [];
  // Сохранённый ответ, которого уже нет среди вариантов, не теряется молча.
  const all = [...options, ...picked.filter((item) => !options.includes(item))];
  const list = { question, value, onPick, picked };
  if (options.length <= PAGE) return <OptionList {...list} fieldId={fieldId} shown={all} />;

  const { shown, found } = visibleOptions(all, picked, query, limit);
  const search = (text: string) => {
    setQuery(text);
    setLimit(PAGE);
  };
  return (
    <>
      <input
        id={fieldId}
        type="search"
        aria-label={`Найти вариант: ${question.text}`}
        placeholder="Найти вариант"
        value={query}
        onChange={(event) => search(event.currentTarget.value)}
      />
      <OptionList {...list} fieldId={undefined} shown={shown} />
      {found === 0 ? <p role="status">Ничего не нашлось</p> : null}
      {found > limit ? (
        <Button variant="quiet" onClick={() => setLimit(limit + PAGE)}>
          Показать ещё
        </Button>
      ) : null}
    </>
  );
}
