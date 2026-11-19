import { PagedList, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import { PlatformRetry } from '../PlatformRetry';
import { CopyButton } from './CopyButton';
import { LinkedinNav } from './LinkedinNav';
import { draftsOfKind } from './linkedinModel';
import { useLinkedinDrafts } from './useLinkedinDrafts';

function Card({ draft }: { readonly draft: LinkedinDraft }) {
  const titleId = `cm-${draft.id}`;
  return (
    <li>
      <article className="lk-card" aria-labelledby={titleId}>
        <h3 className="lk-card-title" id={titleId}>{draft.topic}</h3>
        <label className="lk-lbl" htmlFor={`dr-${draft.id}`}>Черновик</label>
        <textarea className="lk-draft" id={`dr-${draft.id}`} rows={3} readOnly value={draft.text} />
        <div className="actions">
          <CopyButton text={draft.text} label={draft.topic} caption="Скопировать" />
        </div>
      </article>
    </li>
  );
}

function Comments({ drafts }: { readonly drafts: readonly LinkedinDraft[] }) {
  if (!drafts.length) {
    return (
      <section className="lead col-wide" aria-labelledby="c6-a05h">
        <h2 className="lead-title" id="c6-a05h">Комментарии</h2>
        <div className="vl-empty" role="status">
          <p className="vl-empty-t">Новых постов нет</p>
        </div>
      </section>
    );
  }
  return (
    <>
      <div className="list-head">
        <h2 id="cm-title">Комментарии <span className="num dim">· {drafts.length}</span></h2>
      </div>
      <PagedList items={drafts} listClassName="col" renderItem={(draft) => <Card draft={draft} />} />
    </>
  );
}

/** Узел a05 и его пустое состояние a05h: черновики комментариев; радара ленты в данных нет. */
export function FeedScreen({ node }: SectionProps) {
  const load = useLinkedinDrafts();
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <LinkedinNav node="a05" />
      <div className="col">
        {load.state === 'loading' ? <StatusLine state="wait" text="Загружаем комментарии…" /> : null}
        {load.state === 'error' ? <PlatformRetry text="Не удалось загрузить комментарии" onRetry={load.retry} /> : null}
        {load.state === 'ready' ? <Comments drafts={draftsOfKind(load.data, 'comment')} /> : null}
      </div>
      <div className="col" />
    </div>
  );
}
