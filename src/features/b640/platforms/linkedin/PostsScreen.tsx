import { useState } from 'react';
import { Icon, ResultLine, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { useScreenChrome, useShell } from '../../shell/ShellContext';
import { type LinkedinDraft } from '../../../today/linkedinDraftApi';
import { PlatformRetry } from '../PlatformRetry';
import { LiError } from './LiError';
import { DraftEditor } from './DraftEditor';
import { LinkedinList } from './LinkedinList';
import { LinkedinNav } from './LinkedinNav';
import { PublicationRow } from './PublicationRow';
import { currentPostDraft, draftsOfKind } from './linkedinModel';
import { rhythmText, useLinkedinPlan, type LinkedinPlan } from './useLinkedinPlan';
import { formatSlotLong } from '../format';
import { draftErrorText, prepareDraft, useLinkedinDrafts } from './useLinkedinDrafts';

type Prepare =
  { readonly state: 'idle' | 'busy' } | { readonly state: 'error'; readonly text: string };

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
      {prepare.state === 'error' ? (
        <LiError text={prepare.text} onRetry={() => void start()} />
      ) : null}
      <section className="lead" aria-labelledby="po-empty">
        <h2 className="lead-title" id="po-empty">
          Посты
        </h2>
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

function PostList({
  posts,
  slots,
}: {
  readonly posts: readonly LinkedinDraft[];
  readonly slots: ReadonlyMap<string, string>;
}) {
  if (!posts.length) {
    return (
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Постов пока нет</p>
      </div>
    );
  }
  return (
    <section className="mod" aria-labelledby="po-list">
      <h3 className="mod-title" id="po-list">
        Посты
      </h3>
      <LinkedinList
        items={posts}
        listClassName="rows exp-rows"
        renderItem={(post) => <PublicationRow draft={post} slot={slots.get(post.id)} />}
      />
    </section>
  );
}

function Body({
  drafts,
  plan,
  retry,
  onPlaced,
}: {
  readonly drafts: readonly LinkedinDraft[];
  readonly plan: LinkedinPlan;
  readonly retry: () => void;
  readonly onPlaced: (scheduledAt: string) => void;
}) {
  const { search } = useShell();
  const current = currentPostDraft(drafts, new URLSearchParams(search).get('post'));
  return (
    <>
      {current ? (
        <DraftEditor key={current.id} draft={current} onChanged={retry} onPlaced={onPlaced} />
      ) : (
        <Prepared onChanged={retry} />
      )}
      <PostList posts={draftsOfKind(drafts, 'post')} slots={plan.slots} />
    </>
  );
}

/** «О посте → Когда»: слот очереди и ритм; нет ни того, ни другого — блока нет. */
function About({ slot, plan }: { readonly slot: string | null; readonly plan: LinkedinPlan }) {
  const when = [formatSlotLong(slot), rhythmText(plan.rhythm)].filter(Boolean).join(' · ');
  if (!when) return null;
  return (
    <section className="mod" aria-labelledby="po-props">
      <h3 className="mod-title" id="po-props">
        О посте
      </h3>
      <dl className="kv">
        <dt>Когда</dt>
        <dd className="num">{when}</dd>
      </dl>
    </section>
  );
}

/** Узел a03b: черновик поста с «Скопировать» и список постов по 20. */
export function PostsScreen({ node }: SectionProps) {
  const load = useLinkedinDrafts();
  const { plan, retry: reloadPlan } = useLinkedinPlan();
  const [placed, setPlaced] = useState<string | null>(null);
  const onPlaced = (scheduledAt: string) => {
    setPlaced(scheduledAt);
    reloadPlan();
  };
  // Признак макета a03b: плотные строки на 390.
  useScreenChrome({ rootData: { mtight: '1' } });
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <LinkedinNav node="a03b" />
      <div className="col">
        {load.state === 'loading' ? <StatusLine state="wait" text="Загружаем посты…" /> : null}
        {load.state === 'error' ? (
          <PlatformRetry text="Не удалось загрузить посты" onRetry={load.retry} />
        ) : null}
        {placed ? <ResultLine text={`Поставили в план: ${formatSlotLong(placed) ?? ''}`} /> : null}
        {load.state === 'ready' ? (
          <Body drafts={load.data} plan={plan} retry={load.retry} onPlaced={onPlaced} />
        ) : null}
      </div>
      <div className="col">
        {load.state === 'ready' ? <About slot={placed} plan={plan} /> : null}
      </div>
    </div>
  );
}
