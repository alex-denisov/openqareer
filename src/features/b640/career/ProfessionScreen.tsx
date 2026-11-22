import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { pageAttrs } from './careerPaths';
import { ProfessionMoney } from './ProfessionMoney';
import { loadProfession, type ProfessionData, type ProfessionPath } from './professionPathApi';
import { bridgeRole, requirementsMeta } from './professionPathModel';
import { skillCheckPath } from './skillCheckModel';

type Ready = Extract<ProfessionPath, { state: 'ready' }>;

const choosePath = `${buildNodePath('s02')}?status=changing_profession`;
const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

function Step(props: {
  readonly cls: string;
  readonly title: React.ReactNode;
  readonly tip: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className={`step ${props.cls}`.trim()}>
      <span className="step-title">
        {props.title}
        <InfoTip label="Как посчитано" text={props.tip} />
      </span>
      <span className="step-sub" />
      {props.children}
    </li>
  );
}

function BridgeStep({ title, vacancies }: { readonly title: string; readonly vacancies: number }) {
  return (
    <Step
      cls=""
      title={
        <>
          Вакансии в промежуточной роли · <span className="num">{vacancies}</span>
        </>
      }
      tip={`${title}. Здесь ваш опыт ближе к требованиям, недостающее наберёте в работе`}
    >
      <Link className="btn is-quiet" to={buildNodePath('s07')}>
        <Icon name="search" />
        Вакансии
      </Link>
    </Step>
  );
}

function Steps({ path, data }: { readonly path: Ready; readonly data: ProfessionData }) {
  const { openConsultant } = useShell();
  const owned = path.requirements.filter((item) => item.inProfile).map((item) => item.name);
  const bridge = data.roles ? bridgeRole(data.roles.rows, path.target, path.requirements) : null;
  return (
    <ol className="steps">
      <Step
        cls="done"
        title="Что уже есть для новой профессии"
        tip={
          owned.length
            ? `${owned.join(', ')}. Покажет работодателю, чем вы уже подходите`
            : 'Пока ни одного частого требования профессии нет в профиле'
        }
      >
        <span className="step-meta num">{requirementsMeta(path.requirements)}</span>
      </Step>
      <Step cls="now is-next" title="Проверка навыков профессии" tip="Подтвердит навыки в профиле">
        <Link className="btn is-primary" to={skillCheckPath(path.target)}>
          <Icon name="checkc" />
          Проверить
        </Link>
      </Step>
      <Step
        cls=""
        title="Пример из вашего опыта"
        tip="Что решали вы и какое число получили. Одна история для письма и интервью"
      >
        <button className="btn is-quiet" type="button" onClick={() => openConsultant()}>
          <Icon name="chat" />
          Рассказать
        </button>
      </Step>
      {bridge ? <BridgeStep title={bridge.label} vacancies={bridge.vacancies ?? 0} /> : null}
    </ol>
  );
}

function PathLead({ path, data }: { readonly path: Ready; readonly data: ProfessionData }) {
  const bridge = data.roles ? bridgeRole(data.roles.rows, path.target, path.requirements) : null;
  return (
    <section className="lead" aria-labelledby="path-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="path-title">
          Путь в профессию «{path.target}»
        </h2>
        <InfoTip
          label="Как посчитано"
          text={`Частые требования — из ${path.sampleSize} вакансий профессии за 30 дней, на ${dateLabel(path.observedAt)}.`}
        />
      </div>
      {bridge ? <p className="lead-text">Через промежуточную роль: {bridge.label}</p> : null}
      <Steps path={path} data={data} />
      <Link className="s11-resp" to={buildNodePath('o01')}>
        <span className="s11-resp-t">Отклики в новой профессии</span>
        <span className="s11-resp-n">
          Отправлено <span className="num">{path.responses.sent}</span>, приглашений{' '}
          <span className="num">{path.responses.invited}</span>
        </span>
        <Icon name="right" />
      </Link>
    </section>
  );
}

function EmptyLead({ title, line }: { readonly title: string; readonly line?: string }) {
  return (
    <section className="lead" aria-labelledby="path-title">
      <h2 className="lead-title is-long" id="path-title">
        {title}
      </h2>
      {line ? <p className="lead-text">{line}</p> : null}
      <div className="actions">
        <Link className="btn is-primary" to={choosePath}>
          {line ? 'Сменить профессию' : 'Выбрать профессию'}
        </Link>
      </div>
    </section>
  );
}

function PathBody({ data, retry }: { readonly data: ProfessionData; readonly retry: () => void }) {
  const { path } = data;
  if (path.state === 'no_target') return <EmptyLead title="Какую профессию вы осваиваете?" />;
  if (path.state === 'source_unavailable')
    return <BlockError text="Не удалось прочитать вакансии профессии." onRetry={retry} />;
  if (path.state === 'too_few')
    return (
      <EmptyLead
        title={`Путь в профессию «${path.target}»`}
        line={`По профессии мало вакансий для разбора: ${path.sampleSize} из ${path.threshold}.`}
      />
    );
  return (
    <>
      <div className="col">
        <PathLead path={path} data={data} />
      </div>
      <div className="col">
        <ProfessionMoney wage={path.wage} current={data.currentIncome} answer={path.lowerIncome} />
      </div>
    </>
  );
}

/** S11 «Карьера» при «Меняю профессию»: путь в профессию и доход при переходе. */
export function ProfessionScreen({
  node,
  state,
}: {
  readonly node: B640Node;
  readonly state?: string;
}) {
  const load = useLoad(loadProfession);
  const ready = load.state === 'ready' && load.data.path.state === 'ready';
  return (
    <div className={ready ? 'page two' : 'page'} {...pageAttrs(node, state)}>
      {load.state === 'loading' ? (
        <BlockSkeleton label="Собираем путь в профессию" rows={4} />
      ) : load.state === 'error' ? (
        <BlockError text="Не удалось загрузить путь в профессию." onRetry={load.retry} />
      ) : ready ? (
        <PathBody data={load.data} retry={load.retry} />
      ) : (
        <div className="col">
          <PathBody data={load.data} retry={load.retry} />
        </div>
      )}
    </div>
  );
}
