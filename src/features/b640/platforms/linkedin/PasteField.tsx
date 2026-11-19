import { useState } from 'react';
import {
  LINKEDIN_SECTION_LIMITS,
  type LinkedinSection,
  type LinkedinSectionCurrent,
} from '../../../../../shared/b640LinkedinProfile';
import { Icon } from '../../kit';
import { saveSectionCurrent } from './linkedinProfileApi';

interface PasteFieldProps {
  readonly section: LinkedinSection;
  readonly title: string;
  readonly onSaved: (current: LinkedinSectionCurrent) => void;
  /** Текст для «Обновить»: поле открывается с прежним «Сейчас». */
  readonly initial?: string;
}

interface SaveState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly save: (text: string) => Promise<void>;
}

function useSave(
  section: LinkedinSection,
  onSaved: (current: LinkedinSectionCurrent) => void,
): SaveState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = LINKEDIN_SECTION_LIMITS[section];
  async function save(text: string) {
    if (text.trim().length > limit) {
      setError(`Вставьте текст раздела, не длиннее ${limit} знаков.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveSectionCurrent(section, text.trim()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить текст');
      setBusy(false);
    }
  }
  return { busy, error, save };
}

/** Поле «Вставьте текущий текст раздела»: ошибка сохранения остаётся под полем, текст не теряется. */
export function PasteField({ section, title, onSaved, initial = '' }: PasteFieldProps) {
  const [text, setText] = useState(initial);
  const { busy, error, save } = useSave(section, onSaved);
  const fieldId = `li-paste-${section}`;

  return (
    <div className="li-paste">
      <label className="li-rec-l" htmlFor={fieldId}>
        Вставьте текущий текст раздела<span className="vh"> «{title}»</span>
      </label>
      <textarea
        className="li-field"
        id={fieldId}
        rows={4}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-err` : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? (
        <p className="li-err" id={`${fieldId}-err`} role="alert">
          <Icon name="warn" />
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button
          className="btn is-sm"
          type="button"
          aria-label={`Сохранить: ${title}`}
          aria-busy={busy || undefined}
          disabled={busy || !text.trim()}
          onClick={() => void save(text)}
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
