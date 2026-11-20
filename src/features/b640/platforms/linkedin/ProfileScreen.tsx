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
            LinkedIn<span className="vh"> не импортирован</span>
          </h2>
        </div>
        <Link className="btn is-primary" to={buildNodePath('n03')}>
          Импортировать из LinkedIn
          <Icon name="right" />
        </Link>
      </li>
    </ul>
  );
}

function Body({ load }: { readonly load: ReturnType<typeof useLoad<LinkedinProfileView>> }) {
  if (load.state === 'loading') return <StatusLine state="wait" text="Загружаем LinkedIn…" />;
  if (load.state === 'error')
    return <PlatformRetry text="Не удалось загрузить LinkedIn" onRetry={load.retry} />;
  if (load.data.kind === 'no_import') return <NoImport />;
  return <ProfileSections initial={load.data.sections} />;
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

/** Узел a03 и его состояние a03n: семь разделов из импорта LinkedIn или «Импортировать из LinkedIn». */
export function ProfileScreen({ node }: SectionProps) {
  const load = useLoad(getLinkedinProfile);
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
