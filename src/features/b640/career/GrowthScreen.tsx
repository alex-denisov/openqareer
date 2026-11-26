import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { pageAttrs } from './careerPaths';
import { loadGrowth, type GrowthData } from './growthApi';
import { GrowthGoalPick } from './GrowthGoalPick';
import { goalChosenTip, goalCopy, stepTag, wageTip } from './growthModel';
import { formatFork } from './professionPathModel';

type Ready = Extract<GrowthData, { state: 'ready' }>;

const diaryPath = buildNodePath('d00');
const entryPath = (weekStart: string) =>
  `${buildNodePath('d00d')}?week=${encodeURIComponent(weekStart)}`;

function DiarySide() {
  return (
    <section className="mod" aria-labelledby="diary-title">
      <div className="eyebrow">Карьерный дневник</div>
      <h3 className="mod-title" id="diary-title">
        Дневник за год
      </h3>
      <div className="actions">
        <Link className="btn is-quiet" to={diaryPath}>
          <Icon name="diary" />
          Открыть дневник
        </Link>
      </div>
    </section>
  );
}

function GoalLead(props: {
  readonly company: string;
  readonly title: string;
  readonly onSaved: () => void;
}) {
  return (
    <section className="lead" aria-labelledby="goal-title">
      <h2 className="lead-title is-long" id="goal-title">
        Что для вас дальше в компании «{props.company}»?
      </h2>
      <p className="lead-sub">{props.title}</p>
      <GrowthGoalPick current={null} onSaved={props.onSaved} />
    </section>
  );
}

function Steps({ data }: { readonly data: Ready }) {
  if (data.steps.length === 0)
    return (
      <p className="lead-text">
        Шагов к цели пока нет: их берём из плана 90 дней и целей дневника.
      </p>
    );
  return (
    <ol className="steps">
      {data.steps.map((step) => {
        const tag = stepTag(step.state);
        return (
          <li className={tag.cls} key={`${step.title}-${step.source}`}>
            <span className="step-title">{step.title}</span>
            <span className="step-sub">
              {step.sub}
              <InfoTip label="Источник" text={`Источник: ${step.source}`} />
            </span>
            <span className={`tag ${tag.tag}`}>{tag.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** S12: цель, шаги и одна кнопка подготовки разговора (макет s12, без смены цели). */
function GrowLead({ data }: { readonly data: Ready }) {
  const { openConsultant } = useShell();
  const copy = goalCopy(data.goal.kind, data.company);
  return (
    <section className="lead" aria-labelledby="grow-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="grow-title">
          {copy.title}
        </h2>
        <InfoTip label="Источник" text={goalChosenTip(data.goal.chosenAt)} />
      </div>
      <Steps data={data} />
      {copy.action ? (
        <div className="actions">
          <button className="btn is-primary" type="button" onClick={() => openConsultant()}>
            <Icon name="file" />
            {copy.action}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function WageLine({ data }: { readonly data: Ready }) {
  if (!data.wage) return null;
  if (data.wage.state === 'thin')
    return (
      <p className="mod-text">
        {data.title}: мало данных, вакансий с зарплатой{' '}
        <span className="num">{data.wage.sampleSize}</span>
      </p>
    );
  return (
    <p className="mod-text">
      {data.title}: <span className="num">{formatFork(data.wage.min, data.wage.max)}</span>
      <InfoTip label="Источник" text={wageTip(data.wage.sampleSize, data.wage.observedAt)} />
    </p>
  );
}

function Arguments({ data }: { readonly data: Ready }) {
  const copy = goalCopy(data.goal.kind, data.company);
  return (
    <section className="mod" aria-labelledby="arg-title">
      <h3 className="mod-title" id="arg-title">
        {copy.side}
      </h3>
      {data.arguments.length === 0 ? (
        <p className="mod-text">
          В дневнике пока нет записанных результатов.{' '}
          <Link className="row-act is-sm" to={diaryPath}>
            Открыть дневник
          </Link>
        </p>
      ) : (
        <ul className="rows exp-rows">
          {data.arguments.map((item) => (
            <li className="row" key={item.id}>
              <div>
                <div className="row-title">{item.text}</div>
                <div className="row-sub">
                  {item.source} ·{' '}
                  <Link className="row-act is-sm" to={entryPath(item.weekStart)}>
                    Открыть запись
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <WageLine data={data} />
    </section>
  );
}

function NoWorkplace() {
  return (
    <div className="col">
      <section className="lead" aria-labelledby="goal-title">
        <h2 className="lead-title is-long" id="goal-title">
          Где вы работаете сейчас?
        </h2>
        <p className="lead-text">Цель роста ставится для нынешнего места работы из дневника.</p>
        <div className="actions">
          <Link className="btn is-primary" to={diaryPath}>
            <Icon name="diary" />
            Открыть дневник
          </Link>
        </div>
      </section>
    </div>
  );
}

function GrowthBody({ data, reload }: { readonly data: GrowthData; readonly reload: () => void }) {
  if (data.state === 'no_workplace') return <NoWorkplace />;
  return (
    <>
      <div className="col">
        {data.state === 'no_goal' ? (
          <GoalLead company={data.company} title={data.title} onSaved={reload} />
        ) : (
          <GrowLead data={data} />
        )}
      </div>
      <div className="col">
        {data.state === 'no_goal' ? <DiarySide /> : <Arguments data={data} />}
      </div>
    </>
  );
}

const stateOf = (data: GrowthData): string => (data.state === 'ready' ? 's12' : 's12a');

/** S12 «Карьера» при «Работаю»: цель роста в нынешней компании (s12a — цель не задана). */
export function GrowthScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadGrowth);
  // Плотные отступы 390 — только у s12; в макете s12a их нет.
  const ready = load.state === 'ready' && load.data.state === 'ready';
  useScreenChrome(ready ? { rootData: { mtight: '1' } } : {});
  if (load.state === 'loading')
    return (
      <div className="page" {...pageAttrs(node)}>
        <BlockSkeleton label="Собираем шаги к цели" rows={4} />
      </div>
    );
  if (load.state === 'error')
    return (
      <div className="page" {...pageAttrs(node)}>
        <BlockError text="Не удалось загрузить цель роста." onRetry={load.retry} />
      </div>
    );
  const two = load.data.state !== 'no_workplace';
  return (
    <div className={two ? 'page two' : 'page'} {...pageAttrs(node, stateOf(load.data))}>
      <GrowthBody data={load.data} reload={load.retry} />
    </div>
  );
}
