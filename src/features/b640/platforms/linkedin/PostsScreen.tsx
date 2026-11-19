import { useState } from 'react';
import { Icon, PagedList, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { type LinkedinDraft } from '../../../today/linkedinDraftApi';
import { PlatformRetry } from '../PlatformRetry';
import { DraftEditor } from './DraftEditor';
import { LinkedinNav } from './LinkedinNav';
import { PublicationRow } from './PublicationRow';
import { currentPostDraft, draftsOfKind } from './linkedinModel';
import { draftErrorText, prepareDraft, useLinkedinDrafts } from './useLinkedinDrafts';

type Prepare = { readonly state: 'idle' | 'busy' } | { readonly state: 'error'; readonly text: string };

function Prepared({ onChanged }: { readonly onChanged: () => void }) {
  const [prepare, setPrepare] = useState<Prepare>({ state: 'idle' });

  async function start() {
    setPrepare({ state: 'busy' });
    try {
      await prepareDraft();
      setPrepare({ state: 'idle' });
      onChanged();
    } catch (error) {
      setPrepare({ state: 'error', text: draftErrorText(error) });
    }
  }

  if (prepare.state === 'busy') return <StatusLine state="wait" text="Готовим черновик…" />;
  return (
    <>
      {prepare.state === 'error' ? <PlatformRetry text={prepare.text} onRetry={() => void start()} /> : null}
      <section className="lead" aria-labelledby="po-empty">
        <h2 className="lead-title" id="po-empty">Посты</h2>
        <div className="actions">
          <button className="btn is-primary" type="button" onClick={() => void start()}>
            <Icon name="plus" />
            Подготовить черновик
          </button>
        </div>
      </section>
    </>
  );
}

function PostList({ posts }: { readonly posts: readonly LinkedinDraft[] }) {
  if (!posts.length) {
    return (
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Постов пока нет</p>
      </div>
    );
  }
  return (
    <section className="mod" aria-labelledby="po-list">
      <h3 className="mod-title" id="po-list">Посты</h3>
      <PagedList items={posts} listClassName="rows exp-rows" renderItem={(post) => <PublicationRow draft={post} />} />
    </section>
  );
}

function Body({ drafts, retry }: { readonly drafts: readonly LinkedinDraft[]; readonly retry: () => void }) {
  const current = currentPostDraft(drafts);
  return (
    <>
      {current ? <DraftEditor key={current.id} draft={current} onChanged={retry} /> : <Prepared onChanged={retry} />}
      <PostList posts={draftsOfKind(drafts, 'post')} />
    </>
  );
}

/** Узел a03b: черновик поста с «Скопировать» и список постов по 20. */
export function PostsScreen({ node }: SectionProps) {
  const load = useLinkedinDrafts();
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <LinkedinNav node="a03b" />
      <div className="col">
        {load.state === 'loading' ? <StatusLine state="wait" text="Загружаем посты…" /> : null}
        {load.state === 'error' ? <PlatformRetry text="Не удалось загрузить посты" onRetry={load.retry} /> : null}
        {load.state === 'ready' ? <Body drafts={load.data} retry={load.retry} /> : null}
      </div>
      <div className="col" />
    </div>
  );
}
