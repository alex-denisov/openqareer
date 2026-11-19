import { getConnections, type CandidateConnection } from '../../../coach/coachApi';
import { getResumeStudio } from '../../../resume/resumeApi';
import { Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { PlatformRetry } from '../PlatformRetry';
import { CopyButton } from './CopyButton';
import { LinkedinNav } from './LinkedinNav';
import { buildProfileSections, type ProfileRecord, type ProfileSection } from './linkedinModel';

type ProfileData =
  { readonly kind: 'off' } | { readonly kind: 'on'; readonly sections: readonly ProfileSection[] };

function isOn(connections: readonly CandidateConnection[]): boolean {
  const linkedin = connections.find((item) => item.platform === 'linkedin');
  return linkedin !== undefined && linkedin.status !== 'disconnected';
}

async function loadProfile(): Promise<ProfileData> {
  if (!isOn(await getConnections())) return { kind: 'off' };
  const studio = await getResumeStudio();
  return { kind: 'on', sections: buildProfileSections(studio.projection.master) };
}

function NotConnected() {
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

function Record({
  section,
  record,
}: {
  readonly section: ProfileSection;
  readonly record: ProfileRecord;
}) {
  return (
    <div className="li-rec">
      {record.label ? <p className="li-rec-l">{record.label}</p> : null}
      <div className="li-offer">
        <p className="li-new">{record.text}</p>
        <div className="li-offer-a">
          <CopyButton text={record.text} label={record.label ?? section.title} />
        </div>
      </div>
    </div>
  );
}

function Section({ section }: { readonly section: ProfileSection }) {
  const titleId = `ls-${section.id}`;
  return (
    <section className="li-sec" aria-labelledby={titleId}>
      <h3 className="li-sec-t" id={titleId}>
        {section.title}
      </h3>
      {section.records.map((record, index) => (
        <Record key={index} section={section} record={record} />
      ))}
    </section>
  );
}

function Sections({ sections }: { readonly sections: readonly ProfileSection[] }) {
  if (!sections.length) {
    return (
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Для профиля LinkedIn пока нет текстов</p>
      </div>
    );
  }
  return (
    <>
      {sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </>
  );
}

function Body({ load }: { readonly load: ReturnType<typeof useLoad<ProfileData>> }) {
  if (load.state === 'loading') return <StatusLine state="wait" text="Загружаем LinkedIn…" />;
  if (load.state === 'error')
    return <PlatformRetry text="Не удалось загрузить LinkedIn" onRetry={load.retry} />;
  if (load.data.kind === 'off') return <NotConnected />;
  return <Sections sections={load.data.sections} />;
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

/** Узел a03 и его состояние a03n: тексты профиля с «Скопировать» или «LinkedIn не подключён». */
export function ProfileScreen({ node }: SectionProps) {
  const load = useLoad(loadProfile);
  const connected = load.state === 'ready' && load.data.kind === 'on';
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
