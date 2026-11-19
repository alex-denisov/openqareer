import { useEffect, useState } from 'react';
import type { HhResumeEdit, HhResumeEditSection } from '../../../../../shared/hhCandidateSession';
import { Button, Icon, useToast } from '../../kit';

/** B678, A1c: разбор резюме hh.ru — разделы hh.ru, сейчас и предложение платформы. */
const SECTIONS: ReadonlyArray<readonly [HhResumeEditSection, string]> = [
  ['title', 'Должность'],
  ['experience', 'Опыт по местам'],
  ['skills', 'Навыки'],
  ['about', 'О себе'],
];
const COPIED_MS = 2_000;

export function editsWord(count: number): string {
  if (count === 0) return 'Без правок';
  const tens = count % 100;
  const ones = count % 10;
  const word =
    ones === 1 && tens !== 11 ? 'правка' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'правки' : 'правок';
  return `${count} ${word}`;
}

function CopyButton({ text }: { readonly text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    const failed = () => toast.show({ text: 'Не получилось скопировать' });
    try {
      void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(failed);
    } catch {
      failed();
    }
  };
  return (
    <button className="icon-btn" type="button" aria-label={copied ? 'Скопировано' : 'Скопировать'} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

function Lines({ text, className, hidden }: { readonly text: string; readonly className: string; readonly hidden: string }) {
  return (
    <p className={className}>
      <span className="vh">{hidden}</span>
      {text.split('\n').map((line, index) => (
        <span className="hh2-line" key={`${index}-${line.slice(0, 16)}`}>
          {line}
        </span>
      ))}
    </p>
  );
}

function EditRow({ edit }: { readonly edit: HhResumeEdit }) {
  return (
    <li className="hh2-r">
      {edit.place ? <p className="hh2-place">{edit.place}</p> : null}
      {edit.was ? <Lines text={edit.was} className="hh2-was" hidden="Сейчас: " /> : null}
      <div className="hh2-sugg">
        <Lines text={edit.now} className="hh2-now" hidden="Предложение: " />
        <div className="hh2-acts">
          <CopyButton text={edit.now} />
        </div>
      </div>
    </li>
  );
}

export interface HhResumeEditsProps {
  readonly resumeTitle: string;
  readonly edits: readonly HhResumeEdit[];
  readonly onBack: () => void;
}

export function HhResumeEdits({ resumeTitle, edits, onBack }: HhResumeEditsProps) {
  const groups = SECTIONS.map(([section, label]) => [label, edits.filter((edit) => edit.section === section)] as const)
    .filter(([, items]) => items.length > 0);
  return (
    <section className="lead" aria-labelledby="hh2-title">
      <h2 className="lead-title is-long" id="hh2-title">
        Резюме «{resumeTitle}» · {editsWord(edits.length)}
      </h2>
      {groups.map(([label, items], index) => (
        <section className="hh2-sec" aria-labelledby={`hh2-s${index}`} key={label}>
          <h3 className="mod-title" id={`hh2-s${index}`}>
            {label}
          </h3>
          <ul className="hh2-rows">
            {items.map((edit) => (
              <EditRow edit={edit} key={edit.id} />
            ))}
          </ul>
        </section>
      ))}
      <div className="actions">
        <Button icon="back" onClick={onBack}>
          К отправке
        </Button>
      </div>
    </section>
  );
}
