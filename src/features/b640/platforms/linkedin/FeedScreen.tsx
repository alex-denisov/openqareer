import { useState } from 'react';
import type { FeedPostItem } from '../../../../../shared/b640FeedComments';
import { Icon, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { PlatformRetry } from '../PlatformRetry';
import { BringPost } from './BringPost';
import { FeedCard, type Approve } from './FeedCard';
import { LiError } from './LiError';
import { LinkedinList } from './LinkedinList';
import { LinkedinNav } from './LinkedinNav';
import { approveFeedPosts, listFeedPosts } from './linkedinQueueApi';
import { CommentQueue } from './CommentQueue';
import { FeedHead, TopicsLink } from './FeedHead';
import { useCommentPlan, type CommentPlan } from './useCommentPlan';

const REASONS: Readonly<Record<string, string>> = {
  not_found: 'черновик не найден',
  already_published: 'уже опубликован',
  already_queued: 'уже в очереди',
  no_slot: 'нет свободного слота ритма',
};

/** Первый комментарий раскрыт, остальные свёрнуты до начала поста. */
function Item({
  post,
  index,
  approve,
  onChanged,
}: {
  readonly post: FeedPostItem;
  readonly index: number;
  readonly approve: Approve;
  readonly onChanged: () => void;
}) {
  if (index === 0)
    return (
      <li>
        <FeedCard post={post} first approve={approve} onChanged={onChanged} />
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
        <FeedCard post={post} first={false} approve={approve} onChanged={onChanged} />
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
  plan,
  reload,
}: {
  readonly posts: readonly FeedPostItem[];
  readonly plan: CommentPlan | null;
  readonly reload: () => void;
}) {
  const approve = useApprove(reload);
  const open = posts.filter((post) => post.state === 'draft').map((post) => post.draftId);
  return (
    <>
      <FeedHead
        count={posts.length}
        plan={plan}
        open={open}
        busy={approve.busy}
        onApproveAll={() => approve.run(open.slice(0, 20))}
      />
      {approve.error ? (
        <LiError text={approve.error} onRetry={() => approve.run(open.slice(0, 20))} />
      ) : null}
      <LinkedinList
        items={posts}
        listClassName="col"
        renderItem={(post, index) => (
          <Item post={post} index={index} approve={approve.run} onChanged={reload} />
        )}
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
          <div className="actions">
            <TopicsLink />
          </div>
        </div>
        <BringPost onCreated={reload} primary={false} />
      </section>
    </div>
  );
}

const readFeed = () => listFeedPosts();

/** Узел a05 и его пустое состояние a05h: радар ленты по постам, которые приносит кандидат. */
export function FeedScreen({ node }: SectionProps) {
  const load = useLoad(readFeed);
  const { plan, reload: reloadPlan } = useCommentPlan();
  const reload = () => (load.retry(), reloadPlan());
  if (load.state === 'ready' && !load.data.items.length && !plan?.waiting.length)
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
        {load.state === 'ready' && load.data.items.length ? (
          <Comments posts={load.data.items} plan={plan} reload={reload} />
        ) : null}
        {plan?.waiting.length ? (
          <CommentQueue
            // a05b: без нового черновика наверху главная кнопка — «Настроить ритм».
            primary={load.state === 'ready' && load.data.items[0]?.state !== 'draft'}
            rhythm={plan.rhythm}
            items={plan.waiting}
            onChanged={reloadPlan}
            onRhythm={reloadPlan}
          />
        ) : null}
      </div>
      <div className="col">
        {/* Главная на ленте — «Одобрить» или «Настроить ритм»: «Подготовить комментарий» обычная. */}
        {load.state === 'ready' ? <BringPost onCreated={load.retry} primary={false} /> : null}
      </div>
    </div>
  );
}
