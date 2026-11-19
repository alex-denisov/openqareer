import { useState } from 'react';
import type { CareerDiaryDay30Check } from '../../../../shared/careerDiaryCheckpoints';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import type { B640Node } from '../routes';
import { dayLabel } from './adaptationModel';
import { AdaptationGate } from './AdaptationGate';
import { getDay30, markDay30Sent, unmarkDay30Sent } from './checkpointsApi';
import { CopyText, copyText } from './CopyText';
import { useCheckpoint } from './useCheckpoint';

type Ask = 'idle' | 'copied' | 'copy_failed' | 'busy' | 'save_failed';
const today = (): string => new Date().toISOString().slice(0, 10);

function SentLine({ check, ask, onMark, onUnmark }: {
  readonly check: CareerDiaryDay30Check;
  readonly ask: Ask;
  readonly onMark: () => void;
  readonly onUnmark: () => void;
}) {
  if (ask === 'save_failed') return <StatusLine state="err" text="Отметка не сохранилась" action={<button className="row-act" type="button" onClick={check.sentOn ? onUnmark : onMark}>Повторить</button>} />;
  if (ask === 'busy') return <StatusLine state="wait" text="Сохраняем отметку" />;
  if (check.sentOn) {
    return <StatusLine state="ok" text={`Письмо отправлено ${dayLabel(check.sentOn)}`} action={<button className="row-act" type="button" onClick={onUnmark}>Отменить</button>} />;
  }
  if (ask === 'copy_failed') return <StatusLine state="err" text="Не скопировалось — выделите текст письма вручную" />;
  if (ask === 'copied') {
    return <StatusLine state="ok" text="Письмо скопировано" action={<button className="row-act" type="button" onClick={onMark}>Отметить, что отправили</button>} />;
  }
  return null;
}

function Day30Facts({ check }: { readonly check: CareerDiaryDay30Check }) {
  if (check.facts.length === 0) return <p className="mod-text">Добавьте замеры целей и людей на новом месте</p>;
  return (
    <ul className="facts">
      {check.facts.map((fact) => (
        <li className="fact" key={fact.area}>
          <span className="k">{fact.label}</span>
          <span className="v">{fact.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Day30Lead({ check, onChange }: { readonly check: CareerDiaryDay30Check; readonly onChange: (next: CareerDiaryDay30Check) => void }) {
  const [ask, setAsk] = useState<Ask>('idle');
  async function save(write: () => Promise<CareerDiaryDay30Check>) {
    setAsk('busy');
    try {
      onChange(await write());
      setAsk('idle');
    } catch {
      setAsk('save_failed');
    }
  }
  return (
    <section className="lead" aria-labelledby="d30-title">
      <h2 className="lead-title is-long" id="d30-title">
        {check.signal ? 'Проверка на 30‑й день: один сигнал' : 'Проверка на 30‑й день: всё по плану'}
      </h2>
      <p className="lead-sub">{`Проверка консультанта · ${dayLabel(check.dueOn)}`}</p>
      <Day30Facts check={check} />
      <div className="actions">
        <Button variant="primary" icon="calendar" onClick={() => void copyText(check.letter).then((ok) => setAsk(ok ? 'copied' : 'copy_failed'))}>
          Попросить встречу
        </Button>
      </div>
      <SentLine
        check={check}
        ask={ask}
        onMark={() => void save(() => markDay30Sent(check.workplaceId, today()))}
        onUnmark={() => void save(() => unmarkDay30Sent(check.workplaceId))}
      />
    </section>
  );
}

function Letter({ check }: { readonly check: CareerDiaryDay30Check }) {
  return (
    <section className="mod" aria-labelledby="d30-letter">
      <h3 className="mod-title" id="d30-letter">Черновик письма руководителю</h3>
      <p className="mod-text">{`«${check.letter}»`}</p>
      <CopyText text={check.letter} />
    </section>
  );
}

function Day30Body({ workplaceId }: { readonly workplaceId: string }) {
  const { data, reload, replace } = useCheckpoint(workplaceId, getDay30);
  if (data.state === 'loading') return <div className="col"><StatusLine state="wait" text="Собираем проверку" /></div>;
  if (data.state === 'error') {
    return (
      <div className="col">
        <StatusLine state="err" text="Проверка не загрузилась" action={<button className="row-act" type="button" onClick={reload}>Повторить</button>} />
      </div>
    );
  }
  return (
    <>
      <div className="col"><Day30Lead check={data.value} onChange={replace} /></div>
      <div className="col"><Letter check={data.value} /></div>
    </>
  );
}

/** Экран d01e: свод первого месяца, один сигнал и письмо руководителю с просьбой о встрече. */
export function Day30Screen({ node }: { readonly node: B640Node }) {
  return <AdaptationGate node={node} split>{(data) => <Day30Body workplaceId={data.workplace.id} />}</AdaptationGate>;
}
