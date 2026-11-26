import { useState } from 'react';
import { parseOfferLetter, type ParsedOfferLetter } from '../../../../shared/offerLetterParse';
import { Button, InfoTip, StatusLine } from '../kit';

export interface OfferLetterPasteProps {
  /** Подставить разбор в поля; возвращает, сколько полей заполнено. */
  readonly onParsed: (parsed: ParsedOfferLetter) => number;
}

type Outcome = { readonly filled: number; readonly empty?: boolean } | null;

function Outcome({ outcome }: { readonly outcome: Outcome }) {
  if (!outcome) return null;
  if (outcome.empty) return <StatusLine state="err" text="Вставьте текст письма с оффером." />;
  if (outcome.filled === 0) {
    return <StatusLine state="err" text="В письме не нашли условий. Заполните поля сами." />;
  }
  return <StatusLine state="ok" text="Подставили из письма. Проверьте поля в рамке." />;
}

/** «Вставить текст письма с оффером» (O6a): разбор на устройстве, текст никуда не уходит. */
export function OfferLetterPaste({ onParsed }: OfferLetterPasteProps) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  function parse() {
    if (!text.trim()) {
      setOutcome({ filled: 0, empty: true });
      return;
    }
    setOutcome({ filled: onParsed(parseOfferLetter(text, new Date())) });
  }
  return (
    <>
      <div className="field">
        <label htmlFor="of-letter">Вставить текст письма с оффером</label>
        <textarea
          id="of-letter"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setOutcome(null);
          }}
        />
      </div>
      <div className="actions m-commit">
        <Button variant="primary" onClick={parse}>
          Разобрать текст
        </Button>
        <InfoTip
          label="Что будет с текстом"
          text="Текст остаётся у вас. Что нашли в письме, подставим в поля ниже — проверьте каждое."
        />
      </div>
      <Outcome outcome={outcome} />
    </>
  );
}
