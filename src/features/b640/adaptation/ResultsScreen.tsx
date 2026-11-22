import type { CareerDiaryResults90 } from '../../../../shared/careerDiaryCheckpoints';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useScreenChrome } from '../shell/ShellContext';
import { addDays, dayLabel } from './adaptationModel';
import { AdaptationGate } from './AdaptationGate';
import { getResults90 } from './checkpointsApi';
import { CopyText } from './CopyText';
import { TransferBar, useAchievedCards } from './ResultsTransfer';
import { useCheckpoint } from './useCheckpoint';

/** День итогов — 91-й день на новом месте, с годом: «1 марта 2027». */
function summaryDay(periodTo: string): string {
  const day = addDays(periodTo, 1);
  return `${dayLabel(day)} ${day.slice(0, 4)}`;
}

function Items({ results, moved }: { readonly results: CareerDiaryResults90; readonly moved: ReadonlySet<string> }) {
  if (results.items.length === 0) {
    // Без целей итогов нет: одно действие ведёт туда, где их задают (B645, 19.11).
    return (
      <>
        <p className="mod-text">Целей с замерами за 90 дней нет</p>
        <div className="actions">
          <Link className="btn is-primary" to={buildNodePath('d02')}>Задать цели</Link>
        </div>
      </>
    );
  }
  return (
    <ul className="rows exp-rows">
      {results.items.map((item) => (
        <li className="row" key={item.goalId}>
          <div>
            <div className="row-title">{item.title}</div>
            <div className="row-sub">{item.line}</div>
          </div>
          {item.status === 'behind' ? <span className="tag part">отстаёт</span> : null}
          {moved.has(item.goalId) ? <span className="tag ok">Перенесено</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Lead({ results }: { readonly results: CareerDiaryResults90 }) {
  const { cards, replace } = useAchievedCards(results.items);
  const moved = new Set(cards.filter((card) => card.details.transfer).map((card) => card.id));
  return (
    <>
      <section className="lead" aria-labelledby="rs-title">
        <h2 className="lead-title is-long" id="rs-title">Итоги 90 дней</h2>
        <p className="lead-sub">{summaryDay(results.periodTo)}</p>
        <TransferBar cards={cards} onDone={replace} />
        <Items results={results} moved={moved} />
      </section>
      {results.resumeText ? (
        <section className="mod" aria-labelledby="rs-cv">
          <h3 className="mod-title" id="rs-cv">Для резюме</h3>
          <p className="dn-quote">{results.resumeText}</p>
          <CopyText text={results.resumeText} />
        </section>
      ) : null}
    </>
  );
}

function Talk({ results }: { readonly results: CareerDiaryResults90 }) {
  return (
    <section className="mod" {...(results.talkText ? { 'aria-labelledby': 'rs-raise' } : { 'aria-label': 'Что дальше' })}>
      {/* Без текста заголовок не показывается: пустой блок «для разговора» вводит в заблуждение. */}
      {results.talkText ? (
        <>
          <h3 className="mod-title" id="rs-raise">Для разговора об итоговой оценке</h3>
          <p className="dn-quote">{results.talkText}</p>
          <CopyText text={results.talkText} />
        </>
      ) : null}
      <div className="actions dn-links">
        <Link className="row-act" to={buildNodePath('d00')}>Цели на год вперёд</Link>
        <Link className="row-act" to={buildNodePath('s12')}>Что дальше в роли</Link>
      </div>
    </section>
  );
}

function ResultsBody({ workplaceId }: { readonly workplaceId: string }) {
  const { data, reload } = useCheckpoint(workplaceId, getResults90);
  if (data.state === 'loading') return <div className="col"><StatusLine state="wait" text="Собираем итоги" /></div>;
  if (data.state === 'error') {
    return (
      <div className="col">
        <StatusLine state="err" text="Итоги не загрузились" action={<button className="row-act" type="button" onClick={reload}>Повторить</button>} />
      </div>
    );
  }
  return (
    <>
      <div className="col"><Lead results={data.value} /></div>
      <div className="col"><Talk results={data.value} /></div>
    </>
  );
}

/** Экран d04: цели за 90 дней со статусами и два текста — для резюме и для разговора об оценке. */
export function ResultsScreen({ node }: { readonly node: B640Node }) {
  useScreenChrome({ rootData: { mtight: '1' } });
  return <AdaptationGate node={node} split>{(data) => <ResultsBody workplaceId={data.workplace.id} />}</AdaptationGate>;
}
