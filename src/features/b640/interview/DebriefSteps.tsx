import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';

export type DebriefStep = 'source' | 'voices' | 'debrief';

const STEPS: readonly { readonly id: DebriefStep; readonly label: string }[] = [
  { id: 'source', label: 'Запись или файл' },
  { id: 'voices', label: 'Голоса' },
  { id: 'debrief', label: 'Разбор' },
];

function stepPath(step: DebriefStep, responseId: string, inApp: boolean): string {
  if (step === 'debrief') return buildNodePath('i04', { responseId });
  if (step === 'source' && inApp) return buildNodePath('i04b', { responseId });
  return buildNodePath('i04c', { responseId });
}

/** Шаги разбора записи (I4b → I4c → I4): пройденные с галочкой, текущий с номером. */
export function DebriefSteps(props: {
  readonly responseId: string;
  readonly current: DebriefStep;
  readonly inApp: boolean;
}) {
  const index = STEPS.findIndex((step) => step.id === props.current);
  return (
    <ol className="ctx-steps ir-rec-steps" aria-label="Шаги разбора записи">
      {STEPS.map((step, position) => {
        const done = position < index;
        const now = position === index;
        return (
          <li key={step.id} className={done ? 'is-done' : now ? 'is-now' : undefined}>
            <Link
              to={stepPath(step.id, props.responseId, props.inApp)}
              aria-current={now ? 'step' : undefined}
            >
              {done ? <Icon name="check" /> : <span className="num">{position + 1}</span>}
              {step.label}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
