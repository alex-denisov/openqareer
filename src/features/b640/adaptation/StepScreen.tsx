import type {
  CareerDiaryAdaptationGroup,
  CareerDiaryAdaptationStepId,
  CareerDiaryAdaptationStepView,
} from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { addDays, dayLabel, rangeLabel, STEP_HEADING, STEP_SPAN, STEP_TITLE } from './adaptationModel';
import { AdaptationGate, type AdaptationActions } from './AdaptationGate';
import { Relocation } from './Relocation';
import { TaskChecks, type ToggleTask } from './TaskChecks';
import type { AdaptationData } from './useAdaptation';

export const STEP_OF_NODE: Readonly<Record<string, CareerDiaryAdaptationStepId>> = {
  d01a: 'before_start',
  d01b: 'first_two_weeks',
  d01f: 'settling',
};
const NEXT: Readonly<Partial<Record<CareerDiaryAdaptationStepId, string>>> = {
  before_start: 'd01b',
  first_two_weeks: 'd01c',
};
const VISIBLE = 3;

function Group({ group, onToggle, readOnly }: {
  readonly group: CareerDiaryAdaptationGroup;
  readonly onToggle: ToggleTask;
  readonly readOnly: boolean;
}) {
  const shown = group.tasks.slice(0, VISIBLE);
  const rest = group.tasks.slice(VISIBLE);
  return (
    <div className="dn-fs">
      {group.name ? <h3>{group.name}</h3> : null}
      <TaskChecks tasks={shown} onToggle={onToggle} readOnly={readOnly} />
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${rest.length}`}
          </summary>
          <TaskChecks tasks={rest} onToggle={onToggle} readOnly={readOnly} />
        </details>
      ) : null}
    </div>
  );
}

function spanLine(id: CareerDiaryAdaptationStepId, startDate: string): string | null {
  const span = STEP_SPAN[id];
  return span ? rangeLabel(addDays(startDate, span[0]), addDays(startDate, span[1])) : null;
}

function StepBody({ data, step, actions }: {
  readonly data: AdaptationData;
  readonly step: CareerDiaryAdaptationStepView;
  readonly actions: AdaptationActions;
}) {
  const onToggle: ToggleTask = actions.toggleTask;
  const span = spanLine(step.id, data.view.startDate);
  const readOnly = data.workplace.status === 'archived';
  const next = NEXT[step.id];
  return (
    <section className="lead" aria-labelledby="as-title">
      <h2 className="lead-title is-long" id="as-title">
        {STEP_HEADING[step.id] ?? STEP_TITLE[step.id]}
      </h2>
      {span ? <p className="lead-sub">{span}</p> : null}
      {step.id === 'before_start' ? <p className="lead-text">{`Выход ${dayLabel(data.view.startDate)}`}</p> : null}
      {step.id === 'settling' ? <Relocation data={data} onPatch={actions.patchDetails} /> : null}
      {step.groups.map((group) => (
        <Group key={group.name ?? ''} group={group} onToggle={onToggle} readOnly={readOnly} />
      ))}
      {step.tasksTotal === 0 ? <p className="lead-text">Задач в этом шаге нет</p> : null}
      <div className="actions">
        <Link className="btn" to={buildNodePath(next ?? 'd01')}>
          <Icon name={next ? 'right' : 'left'} />
          {next ? NEXT_LABEL[next] : 'План адаптации'}
        </Link>
      </div>
    </section>
  );
}

const NEXT_LABEL: Readonly<Record<string, string>> = {
  d01b: STEP_TITLE.first_two_weeks,
  d01c: 'Встреча с руководителем',
};

/** Экраны шагов d01a, d01b, d01f: задачи шага по группам с отметками. */
export function StepScreen({ node }: { readonly node: B640Node }) {
  const id = STEP_OF_NODE[node.code] ?? 'before_start';
  return (
    <AdaptationGate node={node}>
      {(data, actions) => {
        const step = data.view.steps.find((item) => item.id === id);
        return step ? <StepBody data={data} step={step} actions={actions} /> : null;
      }}
    </AdaptationGate>
  );
}
