import { useState } from 'react';
import {
  B640_CONNECTION_SEARCH_MAX,
  type B640ConnectionList,
} from '../../../../shared/b640Connections';
import { Button, Icon, InfoTip, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { ConnectionRows } from './ConnectionRows';
import { connectionGroups, connectionsHeading } from './connectionsModel';
import { CONNECTIONS_STEP, useConnections } from './useConnections';
import './profile.css';

const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });
const CIRCLES_TIP =
  'Круг 1 — вы знакомы, круг 2 — вас может представить общий контакт, круг 3 — холодный отклик.';

function sourceTip(list: B640ConnectionList): string | null {
  const { state, importedAt, importedCount } = list.linkedinImport;
  if (state !== 'imported') return null;
  const date = importedAt ? new Date(importedAt) : null;
  const when = date && !Number.isNaN(date.getTime()) ? `, обновлено ${DATE.format(date)}` : '';
  return `Связи из LinkedIn: ${importedCount ?? list.connections}${when}.`;
}

interface ToolsProps {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly pool: boolean;
  readonly onPool: (value: boolean) => void;
}

function Tools({ query, onQuery, pool, onPool }: ToolsProps) {
  return (
    <div className="ln-tools">
      <div className="field">
        <label className="vh" htmlFor="ln-q">
          Поиск по связям
        </label>
        <input
          id="ln-q"
          type="text"
          inputMode="search"
          placeholder="Имя или компания"
          maxLength={B640_CONNECTION_SEARCH_MAX}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="check ln-only">
        <input
          id="ln-pool"
          type="checkbox"
          checked={pool}
          onChange={(event) => onPool(event.target.checked)}
        />
        <label htmlFor="ln-pool">Только компании из подборки</label>
      </div>
      <button
        className="chip ln-chip-pool"
        type="button"
        aria-pressed={pool}
        onClick={() => onPool(!pool)}
      >
        Из подборки
      </button>
    </div>
  );
}

function NoContacts() {
  return (
    <div className="actions">
      <Link className="btn is-primary" to={buildNodePath('a03')}>
        <Icon name="linkedin" />
        Подключить LinkedIn
      </Link>
    </div>
  );
}

interface FoundProps {
  readonly list: B640ConnectionList;
  readonly feed: ReturnType<typeof useConnections>;
}

function Found({ list, feed }: FoundProps) {
  const left = list.total - list.items.length;
  const moreFailed = feed.failed === 'more';
  return (
    <>
      {list.items.length > 0 ? (
        <ConnectionRows groups={connectionGroups(list.items)} />
      ) : (
        <p className="mod-text" role="status">
          Никого не нашли
        </p>
      )}
      {left > 0 ? (
        <div className="vl-foot">
          <Button icon="down" busy={feed.busy} onClick={() => void feed.more()}>
            <span>
              {`Показать ещё ${Math.min(CONNECTIONS_STEP, left)} · осталось `}
              <span className="num">{left}</span>
            </span>
          </Button>
        </div>
      ) : null}
      {feed.failed ? (
        <BlockError
          text={moreFailed ? 'Не удалось загрузить ещё связи.' : 'Не удалось загрузить связи.'}
          onRetry={() => (moreFailed ? void feed.more() : feed.retry())}
        />
      ) : null}
    </>
  );
}

function Head({ id, list }: { readonly id: string; readonly list: B640ConnectionList | null }) {
  const heading = list
    ? connectionsHeading(list.connections, list.selectionCompanies)
    : { full: 'Связи', short: 'Связи' };
  const tip = list ? sourceTip(list) : null;
  return (
    <div className="lead-head">
      <h2 className="lead-title is-long" id={id}>
        {heading.full === heading.short ? (
          heading.full
        ) : (
          <>
            <span className="ln-h-d">{heading.full}</span>
            <span className="ln-h-m">{heading.short}</span>
          </>
        )}
        {tip ? (
          <span className="ln-tip-m">
            <InfoTip label="Источник и круги" text={`${tip} ${CIRCLES_TIP}`} />
          </span>
        ) : null}
      </h2>
      {tip ? <InfoTip label="Источник" text={tip} /> : null}
    </div>
  );
}

/** p11 «Связи»: знакомые по компаниям, круг, путь к письму и черновик; ничего не отправляет. */
export function ConnectionsScreen({ node }: { readonly node: B640Node }) {
  const [query, setQuery] = useState('');
  const [pool, setPool] = useState(false);
  const feed = useConnections(query, pool);
  const { list } = feed;
  // p11b: у экрана без связей свой размер заголовка на 390.
  const titleId = list?.connections === 0 ? 'ln0-title' : 'ln-title';
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby={titleId}>
          <Head id={titleId} list={list} />
          {!list && !feed.failed ? <BlockSkeleton label="Загружаем связи" rows={4} /> : null}
          {!list && feed.failed ? (
            <BlockError text="Не удалось загрузить связи." onRetry={feed.retry} />
          ) : null}
          {list && list.connections > 0 ? (
            <>
              <Tools query={query} onQuery={setQuery} pool={pool} onPool={setPool} />
              <Found list={list} feed={feed} />
            </>
          ) : null}
          {list && list.connections === 0 ? <NoContacts /> : null}
        </section>
      </div>
    </div>
  );
}
