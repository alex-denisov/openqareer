import { Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { SectionProps } from '../../sections';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { PlatformRetry } from '../PlatformRetry';
import { formatSlot } from '../format';
import { LinkedinList } from './LinkedinList';
import { LinkedinNav } from './LinkedinNav';
import { draftDate, draftTag, visibleDrafts } from './linkedinModel';
import { useLinkedinDrafts } from './useLinkedinDrafts';
import { useLinkedinPlan } from './useLinkedinPlan';

function Item({ draft, slot }: { readonly draft: LinkedinDraft; readonly slot?: string }) {
  const post = draft.kind === 'post';
  const tag = draftTag(draft.status);
  const date = draftDate(draft) ?? formatSlot(slot);
  return (
    <li className="li-pub">
      <Link className="li-pub-a" to={buildNodePath(post ? 'a03b' : 'a05')}>
        <Icon name={post ? 'note' : 'chat'} label={post ? 'Пост' : 'Комментарий'} />
        <span className="li-pub-m">
          <span className="li-pub-t">{draft.topic}</span>
          {date ? <span className="li-pub-s num">{date}</span> : null}
        </span>
        <span className={tag.className}>{tag.label}</span>
      </Link>
    </li>
  );
}

function List({
  drafts,
  slots,
}: {
  readonly drafts: readonly LinkedinDraft[];
  readonly slots: ReadonlyMap<string, string>;
}) {
  return (
    <>
      <div className="list-head">
        <h2 id="pub-t">
          Публикации <span className="num dim">· {drafts.length}</span>
        </h2>
        <div className="actions li-new-post">
          <Link className="btn is-primary" to={buildNodePath('a03b')}>
            <Icon name="plus" />
            Новый пост
          </Link>
        </div>
      </div>
      {drafts.length ? (
        <LinkedinList
          items={drafts}
          listClassName="li-pubs"
          renderItem={(draft) => <Item draft={draft} slot={slots.get(draft.id)} />}
        />
      ) : (
        <div className="vl-empty" role="status">
          <p className="vl-empty-t">Публикаций пока нет</p>
        </div>
      )}
    </>
  );
}

/** Узел a03p: посты и комментарии одним списком по 20. */
export function PublishedScreen({ node }: SectionProps) {
  const load = useLinkedinDrafts();
  const { plan } = useLinkedinPlan();
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <LinkedinNav node="a03p" />
      <div className="col">
        {load.state === 'loading' ? <StatusLine state="wait" text="Загружаем публикации…" /> : null}
        {load.state === 'error' ? (
          <PlatformRetry text="Не удалось загрузить публикации" onRetry={load.retry} />
        ) : null}
        {load.state === 'ready' ? (
          <List drafts={visibleDrafts(load.data)} slots={plan.slots} />
        ) : null}
      </div>
      <div className="col" />
    </div>
  );
}
