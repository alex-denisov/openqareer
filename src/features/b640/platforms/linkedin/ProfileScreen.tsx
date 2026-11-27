import { useEffect, useRef } from 'react';
import type { LinkedinProfileView } from '../../../../../shared/b640LinkedinProfile';
import { Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { PlatformRetry } from '../PlatformRetry';
import { LinkedinNav } from './LinkedinNav';
import { getLinkedinProfile } from './linkedinProfileApi';
import { ProfileSections } from './ProfileSections';
import './linkedin.css';

/** a03n: импорта LinkedIn нет — разделов не показываем, ручной вставки нет (решение владельца 19.11). */
function NoImport() {
  return (
    <ul className="src-list li-off" aria-label="Площадка">
      <li className="src is-next">
        <span className="src-ico">
          <Icon name="linkedin" />
        </span>
        <div className="src-main">
          <h2 className="src-title">
            LinkedIn<span className="vh"> не подключён</span>
          </h2>
        </div>
        <Link className="btn is-primary" to={buildNodePath('n03')} aria-label="Подключить LinkedIn">
          Подключить
          <Icon name="right" />
        </Link>
      </li>
    </ul>
  );
}

type ProfileLoad = ReturnType<typeof useLoad<LinkedinProfileView>>;

/** Пересказ «О себе» и «Опыта» пишется в фоне: перечитываем экран, пока сервер не скажет, что готово. */
const REWRITE_POLL_MS = 4_000;
const REWRITE_POLLS_MAX = 15;

function useRewriteRefresh(load: ProfileLoad): void {
  const polls = useRef(0);
  const rewriting = load.state === 'ready' && load.data.kind === 'ready' && load.data.rewriting;
  const { retry } = load;
  // Каждый новый ответ сервера — повод решить заново, ждать ли ещё.
  const data = load.state === 'ready' ? load.data : null;
  useEffect(() => {
    if (!rewriting || polls.current >= REWRITE_POLLS_MAX) return undefined;
    const timer = setTimeout(() => {
      polls.current += 1;
      retry();
    }, REWRITE_POLL_MS);
    return () => clearTimeout(timer);
  }, [rewriting, retry, data]);
}

function Body({ load }: { readonly load: ProfileLoad }) {
  if (load.state === 'loading') return <StatusLine state="wait" text="Загружаем LinkedIn…" />;
  if (load.state === 'error')
    return <PlatformRetry text="Не удалось загрузить LinkedIn" onRetry={load.retry} />;
  if (load.data.kind === 'no_import') return <NoImport />;
  const { rewriting, sections } = load.data;
  return (
    <>
      {rewriting ? <StatusLine state="wait" text="Готовим тексты для «О себе» и «Опыта»…" /> : null}
      {/* Готовый пересказ приходит новым чтением: разделы собираются заново с ним. */}
      <ProfileSections key={rewriting ? 'rewriting' : 'ready'} initial={sections} />
    </>
  );
}

function Next() {
  return (
    <section className="mod" aria-labelledby="li-next">
      <h3 className="mod-title" id="li-next">
        Дальше в LinkedIn
      </h3>
      <div className="actions">
        <Link className="btn" to={buildNodePath('a03p')}>
          <Icon name="chat" />
          Открыть публикации
        </Link>
      </div>
    </section>
  );
}

/** Узел a03 и его состояние a03n: семь разделов из импорта LinkedIn или «Подключить». */
export function ProfileScreen({ node }: SectionProps) {
  const load = useLoad(getLinkedinProfile);
  useRewriteRefresh(load);
  const connected = load.state === 'ready' && load.data.kind === 'ready';
  // Признак макета a03: плотные строки на 390; у a03n его нет.
  useScreenChrome({ rootData: connected ? { mtight: '1' } : {} });
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      {connected ? <LinkedinNav node="a03" /> : null}
      <div className="col">
        <Body load={load} />
      </div>
      <div className="col">{connected ? <Next /> : null}</div>
    </div>
  );
}
