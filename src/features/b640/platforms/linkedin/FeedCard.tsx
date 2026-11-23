import { useState } from 'react';
import type { FeedPostItem } from '../../../../../shared/b640FeedComments';
import { updateDraft } from '../../../today/linkedinDraftApi';
import { VariantButton, VariantSwitch } from '../../apply/VariantControls';
import { Button, Icon } from '../../kit';
import { formatSlot } from '../format';
import { LiError } from './LiError';
import { skipFeedPost } from './linkedinQueueApi';
import { usePostVariants } from './usePostVariants';

export type Approve = (ids: readonly string[]) => void;

interface CardProps {
  readonly post: FeedPostItem;
  readonly first: boolean;
  readonly approve: Approve;
  /** Черновик снят с ленты: перечитать ленту и план. */
  readonly onChanged: () => void;
}

interface DraftActionsProps extends CardProps {
  readonly text: string;
  readonly setText: (text: string) => void;
}

/**
 * Действия черновика по макету a05: «Одобрить», «Другой вариант · N», «Пропустить».
 * Одобряется то, что в поле: правка сохраняется до постановки в очередь.
 */
function DraftActions({ post, first, approve, onChanged, text, setText }: DraftActionsProps) {
  const variants = usePostVariants(post.draftId, { draftText: post.comment, text, setText });
  const [error, setError] = useState<{ readonly text: string; readonly retry: () => void } | null>(
    null,
  );
  const run = (action: () => Promise<void>, failure: string) => {
    setError(null);
    action().catch(() => setError({ text: failure, retry: () => run(action, failure) }));
  };
  const onApprove = () =>
    run(async () => {
      if (text !== post.comment) await updateDraft(post.draftId, { text });
      approve([post.draftId]);
    }, 'Не удалось сохранить правку');
  const onSkip = () =>
    run(async () => {
      await skipFeedPost(post.draftId);
      onChanged();
    }, 'Не удалось пропустить пост');
  return (
    <>
      {error ? <LiError text={error.text} onRetry={error.retry} /> : null}
      <div className="actions">
        <Button variant={first ? 'primary' : 'default'} icon="check" onClick={onApprove}>
          Одобрить
        </Button>
        <VariantButton variants={variants} className="row-act" />
        <VariantSwitch variants={variants} label="Варианты комментария" />
        <button className="row-act" type="button" onClick={onSkip}>
          Пропустить
        </button>
      </div>
    </>
  );
}

/** Карточка комментария к посту из ленты (a05). В LinkedIn ничего не уходит: публикует кандидат. */
export function FeedCard(props: CardProps) {
  const { post, first } = props;
  const [text, setText] = useState(post.comment);
  const id = `dr-${post.draftId}`;
  const slot = formatSlot(post.scheduledAt);
  const draft = post.state === 'draft';
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
      <textarea
        className="lk-draft"
        id={id}
        rows={3}
        readOnly={!draft}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      {draft ? <DraftActions {...props} text={text} setText={setText} /> : null}
    </article>
  );
}
