import { useState } from 'react';
import type { FeedPostItem } from '../../../../../shared/b640FeedComments';
import { Button, Icon, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { formatSlot } from '../format';
import { PlatformRetry } from '../PlatformRetry';
import { BringPost } from './BringPost';
import { CopyButton } from './CopyButton';
import { LiError } from './LiError';
import { LinkedinList } from './LinkedinList';
import { LinkedinNav } from './LinkedinNav';
import { approveFeedPosts, listFeedPosts } from './linkedinQueueApi';
import { postsCount } from './linkedinModel';

const REASONS: Readonly<Record<string, string>> = {
  not_found: 'черновик не найден',
  already_published: 'уже опубликован',
  already_queued: 'уже в очереди',
  no_slot: 'нет свободного слота ритма',
};

type Approve = (ids: readonly string[]) => void;

function Card({
  post,
  first,
  approve,
}: {
  readonly post: FeedPostItem;
  readonly first: boolean;
  readonly approve: Approve;
}) {
  const id = `dr-${post.draftId}`;
  const slot = formatSlot(post.scheduledAt);
  return (
    <article className={first ? 'lk-card is-next' : 'lk-card'} aria-label="Комментарий к посту">
      {post.postExcerpt ? <p className="lk-lines">{post.postExcerpt}</p> : null}
      {post.postUrl ? (
        <a className="row-act" href={post.postUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="out" />
          Открыть в LinkedIn
        </a>
      ) : null}
      <div className="lk-dr-top">
        <label className="lk-lbl" htmlFor={id}>
          Черновик
        </label>
        {post.state === 'queued' ? (
          <span className="tag">{slot ? `в очереди · ${slot}` : 'в очереди'}</span>
        ) : null}
        {post.state === 'published' ? <span className="tag ok">опубликован</span> : null}
      </div>
      <textarea className="lk-draft" id={id} rows={3} readOnly value={post.comment} />
      <div className="actions">
        {post.state === 'draft' ? (
          <Button
            variant={first ? 'primary' : 'default'}
            icon="check"
            onClick={() => approve([post.draftId])}
          >
            Одобрить
          </Button>
        ) : null}
        <CopyButton text={post.comment} label="комментарий" caption="Скопировать" className="btn" />
      </div>
    </article>
  );
}

/** Первый комментарий раскрыт, остальные свёрнуты до начала поста. */
function Item({
  post,
  index,
  approve,
}: {
  readonly post: FeedPostItem;
  readonly index: number;
  readonly approve: Approve;
}) {
  if (index === 0)
    return (
      <li>
        <Card post={post} first approve={approve} />
      </li>
    );
  const title =
    post.postExcerpt.length > 80 ? `${post.postExcerpt.slice(0, 80)}…` : post.postExcerpt;
  return (
    <li>
      <details className="lk-fold">
        <summary className="hire-ref-s">
          <span>
            <b>{title || 'Пост из ленты'}</b>
          </span>
          <Icon name="down" className="hire-ref-chev" />
        </summary>
        <Card post={post} first={false} approve={approve} />
      </details>
    </li>
  );
}

function useApprove(reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run: Approve = (ids) => {
    setBusy(true);
    setError(null);
    approveFeedPosts(ids)
      .then(({ results }) => {
        const failed = results.flatMap((result) =>
          result.ok ? [] : [REASONS[result.reason] ?? result.reason],
        );
        if (failed.length)
          setError(`Не всё поставлено в очередь: ${[...new Set(failed)].join(', ')}`);
        reload();
      })
      .catch(() => setError('Не удалось одобрить. Попробуйте ещё раз'))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}

function Comments({
  posts,
  reload,
}: {
  readonly posts: readonly FeedPostItem[];
  readonly reload: () => void;
}) {
  const approve = useApprove(reload);
  const open = posts.filter((post) => post.state === 'draft').map((post) => post.draftId);
  return (
    <>
      <div className="list-head">
        <h2 id="cm-title">{postsCount(posts.length)}</h2>
        {open.length > 1 ? (
          <Button
            size="sm"
            icon="check"
            busy={approve.busy}
            onClick={() => approve.run(open.slice(0, 20))}
          >
            {`Одобрить все · ${Math.min(open.length, 20)}`}
          </Button>
        ) : null}
      </div>
      {approve.error ? (
        <LiError text={approve.error} onRetry={() => approve.run(open.slice(0, 20))} />
      ) : null}
      <LinkedinList
        items={posts}
        listClassName="col"
        renderItem={(post, index) => <Item post={post} index={index} approve={approve.run} />}
      />
    </>
  );
}

/** a05h: новых постов нет; без переключателей, как в макете, но с формой «принести пост». */
function Empty({ node, reload }: Pick<SectionProps, 'node'> & { readonly reload: () => void }) {
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <section className="lead col-wide" aria-labelledby="c6-a05h">
        <h2 className="lead-title" id="c6-a05h">
          Комментарии
        </h2>
        <div className="vl-empty" role="status">
          <p className="vl-empty-t">Новых постов нет</p>
        </div>
        <BringPost onCreated={reload} />
      </section>
    </div>
  );
}

const readFeed = () => listFeedPosts();

/** Узел a05 и его пустое состояние a05h: радар ленты по постам, которые приносит кандидат. */
export function FeedScreen({ node }: SectionProps) {
  const load = useLoad(readFeed);
  if (load.state === 'ready' && !load.data.items.length)
    return <Empty node={node} reload={load.retry} />;
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <LinkedinNav node="a05" />
      <div className="col">
        {load.state === 'loading' ? (
          <StatusLine state="wait" text="Загружаем комментарии…" />
        ) : null}
        {load.state === 'error' ? (
          <PlatformRetry text="Не удалось загрузить комментарии" onRetry={load.retry} />
        ) : null}
        {load.state === 'ready' ? <Comments posts={load.data.items} reload={load.retry} /> : null}
      </div>
      <div className="col">
        {load.state === 'ready' ? <BringPost onCreated={load.retry} /> : null}
      </div>
    </div>
  );
}
