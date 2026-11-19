import { getConnections, type CandidateConnection } from '../../../coach/coachApi';
import { getResumeStudio } from '../../../resume/resumeApi';
import { Icon, InfoTip, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { PlatformRetry } from '../PlatformRetry';
import { CopyButton } from './CopyButton';
import { LinkedinNav } from './LinkedinNav';
import { buildProfileSections, type ProfileSection } from './linkedinModel';

type ProfileData =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly sections: readonly ProfileSection[] };

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
        <span className="src-ico"><Icon name="linkedin" /></span>
        <div className="src-main">
          <h2 className="src-title">LinkedIn<span className="vh"> не подключён</span></h2>
        </div>
        <Link className="btn is-primary" to={buildNodePath('n03')} aria-label="Подключить LinkedIn">
          Подключить
          <Icon name="right" />
        </Link>
      </li>
    </ul>
  );
}

function Section({ section }: { readonly section: ProfileSection }) {
  const titleId = `ls-${section.id}`;
  return (
    <section className="li-sec" aria-labelledby={titleId}>
      <h3 className="li-sec-t" id={titleId}>{section.title}</h3>
      <div className="li-rec">
        <div className="li-offer">
          <p className="li-new">{section.text}</p>
          <div className="li-offer-a">
            <CopyButton text={section.text} label={section.title} />
          </div>
        </div>
      </div>
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
      <div className="list-head">
        <h2 id="li-title">Тексты для профиля</h2>
        <InfoTip label="Откуда тексты" text="Резюме в OpenQareer: целевая роль, раздел «О себе» и навыки." />
      </div>
      {sections.map((section) => <Section key={section.id} section={section} />)}
    </>
  );
}

function Body({ load }: { readonly load: ReturnType<typeof useLoad<ProfileData>> }) {
  if (load.state === 'loading') return <StatusLine state="wait" text="Загружаем LinkedIn…" />;
  if (load.state === 'error') return <PlatformRetry text="Не удалось загрузить LinkedIn" onRetry={load.retry} />;
  if (load.data.kind === 'off') return <NotConnected />;
  return <Sections sections={load.data.sections} />;
}

/** Узел a03 и его состояние a03n: тексты профиля с «Скопировать» или «LinkedIn не подключён». */
export function ProfileScreen({ node }: SectionProps) {
  const load = useLoad(loadProfile);
  const connected = load.state === 'ready' && load.data.kind === 'on';
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      {connected ? <LinkedinNav node="a03" /> : null}
      <div className="col">
        <Body load={load} />
      </div>
      <div className="col" />
    </div>
  );
}
