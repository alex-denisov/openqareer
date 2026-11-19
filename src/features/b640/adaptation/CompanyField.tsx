import { useEffect, useState, type KeyboardEvent } from 'react';
import { listApplicationsPool } from '../../applications/applicationsApi';
import { companySuggestions, type CompanySuggestion, type ResponseLike } from './responseCompanies';

/** Отклики кандидата для подсказки; не прочитались — подсказки просто нет. */
function useResponses(): readonly ResponseLike[] {
  const [responses, setResponses] = useState<readonly ResponseLike[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listApplicationsPool({}, controller.signal)
      .then((page) => setResponses(page.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return responses;
}

interface CompanyFieldProps {
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
  readonly onPick: (suggestion: CompanySuggestion) => void;
}

const LIST_ID = 'ap-company-list';
const optionId = (index: number) => `ap-company-o${index}`;

function SuggestionList(props: {
  readonly items: readonly CompanySuggestion[];
  readonly active: number;
  readonly onPick: (suggestion: CompanySuggestion) => void;
}) {
  return (
    <ul className="ac-list" id={LIST_ID} role="listbox" aria-label="Компании из откликов">
      {props.items.map((item, index) => (
        // Клавиатура — у поля: стрелки и Enter через aria-activedescendant.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <li
          key={item.key}
          id={optionId(index)}
          role="option"
          aria-selected={index === props.active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onPick(item)}
        >
          <span className="ac-t">{item.company}</span>
          <span className="ac-v">{item.line}</span>
        </li>
      ))}
    </ul>
  );
}

/** Открытый список, выбранная строка и клавиши поля. */
function useCombobox(value: string, onPick: (suggestion: CompanySuggestion) => void) {
  const responses = useResponses();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = open ? companySuggestions(responses, value) : [];
  const expanded = items.length > 0;
  const pick = (item: CompanySuggestion) => {
    setOpen(false);
    setActive(-1);
    onPick(item);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!expanded) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      setActive((current) => (current + step + items.length) % items.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };
  const typed = () => {
    setOpen(true);
    setActive(-1);
  };
  return { items, expanded, active, pick, onKeyDown, typed, close: () => setOpen(false) };
}

/** d01h: «Компания» с подсказкой компаний из откликов кандидата. */
export function CompanyField({ value, error, onChange, onPick }: CompanyFieldProps) {
  const { items, expanded, active, pick, onKeyDown, typed, close } = useCombobox(value, onPick);
  return (
    <div className="gb-f gb-name gb-co">
      <label htmlFor="ap-company">Компания</label>
      <div className="ac-wrap">
        <input
          id="ap-company"
          type="text"
          role="combobox"
          autoComplete="organization"
          maxLength={200}
          value={value}
          aria-expanded={expanded}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            typed();
            onChange(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        {expanded ? <SuggestionList items={items} active={active} onPick={pick} /> : null}
      </div>
      {error ? <p className="va-err" role="alert">{error}</p> : null}
    </div>
  );
}
