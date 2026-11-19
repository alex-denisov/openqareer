import { useState } from 'react';
import type {
  LinkedinSection,
  LinkedinSectionSuggestion,
} from '../../../../../shared/b640LinkedinProfile';
import { Icon } from '../../kit';
import { formatDay } from '../format';
import { CopyButton } from './CopyButton';
import { LiError } from './LiError';
import { markSectionCopied, markSectionPasted, type SectionMarks } from './linkedinProfileApi';
import { LINKEDIN_OWN_PROFILE_URL } from './profileSectionModel';

type Mark = 'copied' | 'pasted';

interface SectionOfferProps {
  readonly section: LinkedinSection;
  readonly title: string;
  readonly suggestion: LinkedinSectionSuggestion;
  readonly pastedAt: string | null;
  readonly onMarks: (marks: SectionMarks) => void;
}

function Facts({ suggestion }: { readonly suggestion: LinkedinSectionSuggestion }) {
  if (!suggestion.facts.length) return null;
  return (
    <ul className="li-facts" aria-label="Факты, на которых построено предложение">
      {suggestion.facts.map((fact) => (
        <li key={fact.id}>{fact.text}</li>
      ))}
    </ul>
  );
}

function useMarks(section: LinkedinSection, onMarks: (marks: SectionMarks) => void) {
  const [busy, setBusy] = useState<Mark | null>(null);
  const [failed, setFailed] = useState<Mark | null>(null);
  async function mark(kind: Mark) {
    setBusy(kind);
    setFailed(null);
    try {
      onMarks(await (kind === 'copied' ? markSectionCopied : markSectionPasted)(section));
    } catch {
      setFailed(kind);
    } finally {
      setBusy(null);
    }
  }
  return { busy, failed, mark };
}

function PastedControl({
  title,
  pastedAt,
  busy,
  onPasted,
}: {
  readonly title: string;
  readonly pastedAt: string | null;
  readonly busy: boolean;
  readonly onPasted: () => void;
}) {
  if (pastedAt) {
    const day = formatDay(pastedAt);
    return (
      <span className="li-pasted" role="status">
        <Icon name="check" />
        {day ? `Вставлено ${day}` : 'Вставлено'}
      </span>
    );
  }
  return (
    <button
      className="btn is-sm"
      type="button"
      aria-label={`Вставлено: ${title}`}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={onPasted}
    >
      <Icon name="check" />
      Вставлено
    </button>
  );
}

/** Предложение раздела: «Скопировать», «Открыть в LinkedIn», «Вставлено»; на LinkedIn ничего не уходит. */
export function SectionOffer({ section, title, suggestion, pastedAt, onMarks }: SectionOfferProps) {
  const { busy, failed, mark } = useMarks(section, onMarks);
  return (
    <>
      <div className="li-offer">
        <p className="li-new">{suggestion.text}</p>
        <div className="li-offer-a">
          <CopyButton text={suggestion.text} label={title} onCopied={() => void mark('copied')} />
          <a
            className="icon-btn"
            href={LINKEDIN_OWN_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть в LinkedIn: ${title}`}
          >
            <Icon name="out" />
          </a>
          <PastedControl
            title={title}
            pastedAt={pastedAt}
            busy={busy === 'pasted'}
            onPasted={() => void mark('pasted')}
          />
        </div>
      </div>
      <Facts suggestion={suggestion} />
      {failed ? <LiError text="Не удалось сохранить отметку" onRetry={() => void mark(failed)} /> : null}
    </>
  );
}
