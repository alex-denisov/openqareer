import { useState, type ReactNode } from 'react';
import type {
  LinkedinSection,
  LinkedinSectionFact,
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

/** B645: факты под предложением свёрнуты — в длинных разделах они длиннее самого предложения. */
function Facts({ facts }: { readonly facts: readonly LinkedinSectionFact[] }) {
  if (!facts.length) return null;
  return (
    <details className="li-facts-d">
      <summary>{`Из каких фактов · ${facts.length}`}</summary>
      <ul className="li-facts" aria-label="Факты, на которых построено предложение">
        {facts.map((fact) => (
          <li key={fact.id}>{fact.text}</li>
        ))}
      </ul>
    </details>
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

function OpenLink({ title }: { readonly title: string }) {
  return (
    <a
      className="icon-btn"
      href={LINKEDIN_OWN_PROFILE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Открыть в LinkedIn: ${title}`}
    >
      <Icon name="out" />
    </a>
  );
}

interface OfferBlockProps {
  readonly text: string;
  readonly label: string;
  readonly onCopied: () => void;
  readonly children?: ReactNode;
}

/** Текст предложения и действия справа от него. */
function OfferBlock({ text, label, onCopied, children }: OfferBlockProps) {
  return (
    <div className="li-offer">
      <p className="li-new">{text}</p>
      <div className="li-offer-a">
        <CopyButton text={text} label={label} onCopied={onCopied} />
        <OpenLink title={label} />
        {children}
      </div>
    </div>
  );
}

/**
 * Предложение раздела: «Скопировать», «Открыть в LinkedIn», «Вставлено»; на LinkedIn ничего не уходит.
 * «Опыт» — по месту работы; у «Навыков» список фактов повторил бы само предложение и не показывается.
 */
export function SectionOffer({ section, title, suggestion, pastedAt, onMarks }: SectionOfferProps) {
  const { busy, failed, mark } = useMarks(section, onMarks);
  const pasted = (
    <PastedControl title={title} pastedAt={pastedAt} busy={busy === 'pasted'} onPasted={() => void mark('pasted')} />
  );
  const copied = () => void mark('copied');
  return (
    <>
      {suggestion.items?.length ? (
        <>
          {suggestion.items.map((item) => (
            <div className="li-item" key={item.id}>
              <p className="li-rec-l">{item.label}</p>
              <OfferBlock text={item.text} label={item.label} onCopied={copied} />
              <Facts facts={item.facts} />
            </div>
          ))}
          <div className="li-offer-a">{pasted}</div>
        </>
      ) : (
        <>
          <OfferBlock text={suggestion.text} label={title} onCopied={copied}>
            {pasted}
          </OfferBlock>
          {section === 'skills' ? null : <Facts facts={suggestion.facts} />}
        </>
      )}
      {failed ? <LiError text="Не удалось сохранить отметку" onRetry={() => void mark(failed)} /> : null}
    </>
  );
}
