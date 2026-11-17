import { useEffect, useState } from 'react';
import {
  listCandidateConnectionContacts,
  type CandidateConnectionContact,
  type CandidateConnectionContactsPage,
} from '../../outreach/connectionContactsApi';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { contactGroups, contactsHeading, type ContactGroup } from './partTwoModel';

const STEP = 20;
/** Потолок дочитывания при поиске: 50 страниц по 100 связей. */
const MAX_SEARCH_PAGES = 50;
const DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });

function loadFirst(): Promise<CandidateConnectionContactsPage> {
  return listCandidateConnectionContacts(0);
}

function sourceTip(page: CandidateConnectionContactsPage): string | null {
  const { state, importedAt, importedCount } = page.linkedinImport;
  if (state !== 'imported') return null;
  const date = importedAt ? new Date(importedAt) : null;
  const when = date && !Number.isNaN(date.getTime()) ? `, обновлено ${DATE.format(date)}` : '';
  return `Связи из LinkedIn: ${importedCount ?? page.total}${when}.`;
}

function Groups({ groups }: { readonly groups: readonly ContactGroup[] }) {
  return (
    <ul className="ln-list" aria-label="Связи по компаниям">
      {groups.map((group) => (
        <li className="ln-co" key={group.company}>
          <h3 className="ln-co-t">{group.company}</h3>
          <ul className="rows">
            {group.people.map((person) => (
              <li className="row ln-row" key={person.id}>
                <div>
                  <div className="row-title">{person.name}</div>
                  {person.role ? <div className="row-sub">{person.role}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

interface Feed {
  readonly items: readonly CandidateConnectionContact[];
  readonly total: number;
  readonly nextOffset: number | null;
}

async function readRest(feed: Feed): Promise<Feed> {
  let items = feed.items;
  let offset = feed.nextOffset;
  let total = feed.total;
  for (let page = 0; offset !== null && page < MAX_SEARCH_PAGES; page += 1) {
    const next = await listCandidateConnectionContacts(offset);
    const known = new Set(items.map((item) => item.id));
    items = [...items, ...next.items.filter((item) => !known.has(item.id))];
    offset = next.nextOffset;
    total = next.total;
  }
  return { items, total, nextOffset: offset };
}

/** Показываем по 20; когда загруженное кончается, читаем следующую порцию с сервера. */
function useContacts(first: CandidateConnectionContactsPage) {
  const [feed, setFeed] = useState<Feed>(first);
  const [shown, setShown] = useState(STEP);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (busy) return;
    const next = shown + STEP;
    if (next > feed.items.length && feed.nextOffset !== null) {
      setBusy(true);
      setFailed(false);
      try {
        const page = await listCandidateConnectionContacts(feed.nextOffset);
        const known = new Set(feed.items.map((item) => item.id));
        setFeed({
          items: [...feed.items, ...page.items.filter((item) => !known.has(item.id))],
          total: page.total,
          nextOffset: page.nextOffset,
        });
      } catch {
        setFailed(true);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setShown(next);
  }

  /** Поиск идёт по загруженным связям, поэтому при поиске дочитываем остальные. */
  async function loadRest() {
    if (busy || feed.nextOffset === null) return;
    setBusy(true);
    setFailed(false);
    try {
      setFeed(await readRest(feed));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return { feed, shown, busy, failed, more, loadRest };
}

function Contacts({ first }: { readonly first: CandidateConnectionContactsPage }) {
  const { feed, shown, busy, failed, more, loadRest } = useContacts(first);
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const partial = searching && feed.nextOffset !== null;
  useEffect(() => {
    if (partial && !busy && !failed) void loadRest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- запуск по смене условия, а не функции
  }, [partial, busy, failed]);
  const groups = contactGroups(searching ? feed.items : feed.items.slice(0, shown), query);
  const left = feed.total - Math.min(shown, feed.items.length);
  return (
    <>
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {partial && !failed ? <StatusLine state="wait" text="Ищем по всем связям…" /> : null}
      {groups.length > 0 ? <Groups groups={groups} /> : null}
      {groups.length === 0 && !partial ? <p className="mod-text">Никого не нашли</p> : null}
      {!searching && left > 0 ? (
        <div className="vl-foot">
          <Button icon="down" busy={busy} onClick={() => void more()}>
            <span>{`Показать ещё ${Math.min(STEP, left)}`}</span>
          </Button>
        </div>
      ) : null}
      {failed ? (
        <BlockError
          text="Не удалось загрузить ещё связи."
          onRetry={() => void (searching ? loadRest() : more())}
        />
      ) : null}
    </>
  );
}

function NoContacts() {
  return (
    <div className="actions">
      <Link className="btn" to={buildNodePath('a03')}>
        <Icon name="linkedin" />
        Подключить LinkedIn
      </Link>
    </div>
  );
}

/** p11 «Связи»: знакомые по компаниям, поиск по имени и компании, по 20 на порцию. */
export function ConnectionsScreen({ node }: { readonly node: B640Node }) {
  const first = useLoad(loadFirst);
  const tip = first.state === 'ready' ? sourceTip(first.data) : null;
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="ln-title">
          <div className="lead-head">
            <h2 className="lead-title is-long" id="ln-title">
              {first.state === 'ready' ? contactsHeading(first.data.total) : 'Связи'}
            </h2>
            {tip ? <InfoTip label="Источник" text={tip} /> : null}
          </div>
          {first.state === 'loading' ? <BlockSkeleton label="Загружаем связи" rows={4} /> : null}
          {first.state === 'error' ? (
            <BlockError text="Не удалось загрузить связи." onRetry={first.retry} />
          ) : null}
          {first.state === 'ready' && first.data.total > 0 ? <Contacts first={first.data} /> : null}
          {first.state === 'ready' && first.data.total === 0 ? <NoContacts /> : null}
        </section>
      </div>
    </div>
  );
}
