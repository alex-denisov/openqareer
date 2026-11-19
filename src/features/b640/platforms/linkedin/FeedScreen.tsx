import { Icon, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { PlatformRetry } from '../PlatformRetry';
import { CopyButton } from './CopyButton';
import { LinkedinList } from './LinkedinList';
import { LinkedinNav } from './LinkedinNav';
import { draftsOfKind, postsCount } from './linkedinModel';
import { useLinkedinDrafts } from './useLinkedinDrafts';

function Card({ draft, first }: { readonly draft: LinkedinDraft; readonly first: boolean }) {
  const titleId = `cm-${draft.id}`;
  return (
    <article className={first ? 'lk-card is-next' : 'lk-card'} aria-labelledby={titleId}>
      <h3 className="lk-card-title" id={titleId}>
        {draft.topic}
      </h3>
      <div className="lk-dr-top">
        <label className="lk-lbl" htmlFor={`dr-${draft.id}`}>
          Черновик
        </label>
      </div>
      <textarea className="lk-draft" id={`dr-${draft.id}`} rows={3} readOnly value={draft.text} />
      <div className="actions">
        <CopyButton text={draft.text} label={draft.topic} caption="Скопировать" />
      </div>
    </article>
  );
}

/** Первый комментарий раскрыт, остальные свёрнуты до названия поста. */
function Item({ draft, index }: { readonly draft: LinkedinDraft; readonly index: number }) {
  if (index === 0)
    return (
      <li>
        <Card draft={draft} first />
      </li>
    );
  return (
    <li>
      <details className="lk-fold">
        <summary className="hire-ref-s">
          <span>
            <b>{draft.topic}</b>
          </span>
          <Icon name="down" className="hire-ref-chev" />
        </summary>
        <Card draft={draft} first={false} />
      </details>
    </li>
  );
}

function Comments({ drafts }: { readonly drafts: readonly LinkedinDraft[] }) {
  return (
    <>
      <div className="list-head">
        <h2 id="cm-title">{postsCount(drafts.length)}</h2>
      </div>
      <LinkedinList
        items={drafts}
        listClassName="col"
        renderItem={(draft, index) => <Item draft={draft} index={index} />}
      />
    </>
  );
}

/** a05h: новых постов нет; без переключателя «Профиль / Публикации», как в макете. */
function Empty({ node }: Pick<SectionProps, 'node'>) {
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <section className="lead col-wide" aria-labelledby="c6-a05h">
        <h2 className="lead-title" id="c6-a05h">
          Комментарии
        </h2>
        <div className="vl-empty" role="status">
          <p className="vl-empty-t">Новых постов нет</p>
        </div>
      </section>
    </div>
  );
}

/** Узел a05 и его пустое состояние a05h: черновики комментариев; радара ленты в данных нет. */
export function FeedScreen({ node }: SectionProps) {
  const load = useLinkedinDrafts();
  const comments = load.state === 'ready' ? draftsOfKind(load.data, 'comment') : [];
  if (load.state === 'ready' && !comments.length) return <Empty node={node} />;
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
        {load.state === 'ready' ? <Comments drafts={comments} /> : null}
      </div>
      <div className="col" />
    </div>
  );
}
