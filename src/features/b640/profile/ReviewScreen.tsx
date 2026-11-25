import { useState } from 'react';
import { pluralRu } from '../../../../shared/pluralRu';
import { apiErrorMessage } from '../../coach/apiClient';
import { getCandidate } from '../../coach/candidateSnapshotApi';
import { confirmProfileExperience } from '../../resume/profileHistoryApi';
import { getResumeStudio } from '../../resume/resumeApi';
import { ActionDock, Button, Icon, Link, StatusLine, useIsMobile } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { reviewRows, type ReviewRow } from './experienceForm';
import { splitVisible } from './profileModel';

const VISIBLE = 3;

async function loadReview(): Promise<readonly ReviewRow[]> {
  const [view, candidate] = await Promise.all([getResumeStudio(), getCandidate()]);
  return view.draft ? reviewRows(view.draft, candidate.memory) : [];
}

type ConfirmState = 'idle' | 'busy' | 'done' | { readonly error: string };

function ReviewCard({ row }: { readonly row: ReviewRow }) {
  const [state, setState] = useState<ConfirmState>(row.confirmed ? 'done' : 'idle');
  const name = row.employer || row.title;

  async function confirm() {
    setState('busy');
    try {
      await confirmProfileExperience(row.id);
      setState('done');
    } catch (reason) {
      setState({ error: apiErrorMessage(reason, 'Не удалось подтвердить запись.') });
    }
  }

  return (
    <article className="pg pw" aria-labelledby={`pw-${row.id}`}>
      <h3 className="pg-t" id={`pw-${row.id}`}>
        {row.title}
      </h3>
      <dl className="pw-kv">
        <dt>Компания</dt>
        <dd>{row.employer || <span className="dim">не указана</span>}</dd>
        <dt>Даты</dt>
        <dd className="num">{row.period || <span className="dim">не указаны</span>}</dd>
        <dt>Команда</dt>
        <dd>{row.team ?? <span className="dim">не указана</span>}</dd>
      </dl>
      <div className="pr-acts">
        {state === 'done' ? (
          <span className="pw-ok">
            <Icon name="check" />
            Подтверждено
          </span>
        ) : (
          <Button
            icon="check"
            busy={state === 'busy'}
            aria-label={`Верно: ${name}`}
            onClick={() => void confirm()}
          >
            Верно
          </Button>
        )}
        <Link className="row-act" to={row.editPath} aria-label={`Исправить: ${name}`}>
          <Icon name="edit" />
          Исправить
        </Link>
      </div>
      {typeof state === 'object' ? <StatusLine state="err" text={state.error} /> : null}
    </article>
  );
}

function ReviewList({ rows }: { readonly rows: readonly ReviewRow[] }) {
  const { shown, rest } = splitVisible(rows, VISIBLE);
  const names = rest
    .map((row) => row.employer)
    .filter(Boolean)
    .join(', ');
  if (rows.length === 0) return <p className="mod-text">Мест работы пока нет</p>;
  return (
    <>
      {shown.map((row) => (
        <ReviewCard row={row} key={row.id} />
      ))}
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${pluralRu(rest.length, ['место работы', 'места работы', 'мест работы'])}`}
            {names ? <span className="dim">{` · ${names}`}</span> : null}
          </summary>
          {rest.map((row) => (
            <ReviewCard row={row} key={row.id} />
          ))}
        </details>
      ) : null}
    </>
  );
}

/** p06 «Проверка записей»: как прочитан профиль, «Верно» или «Исправить» у каждого места. */
export function ReviewScreen({ node }: { readonly node: B640Node }) {
  const rows = useLoad(loadReview);
  const mobile = useIsMobile();
  const next = (
    <Link className="btn is-primary" to={buildNodePath('s01')}>
      <Icon name="arrow" />
      Дальше
    </Link>
  );
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="pf-t">
          <h2 className="lead-title is-long" id="pf-t">
            Так мы прочитали ваш профиль — всё верно?
          </h2>
          {rows.state === 'loading' ? <BlockSkeleton label="Загружаем записи" rows={3} /> : null}
          {rows.state === 'error' ? (
            <BlockError text="Не удалось загрузить записи." onRetry={rows.retry} />
          ) : null}
          {rows.state === 'ready' ? <ReviewList rows={rows.data} /> : null}
          {mobile ? <ActionDock kind="commit" primary={next} /> : null}
        </section>
      </div>
      {mobile ? null : <ActionDock kind="auto" primary={next} />}
    </div>
  );
}
