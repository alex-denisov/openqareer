import type { InterviewDebriefView } from '../../../../server/domain/interviewDebriefView';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';

type StepsDebrief = Pick<InterviewDebriefView, 'recording' | 'voices'>;

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

/** Какие шаги пройдены: без записи — ни один, голоса — когда расшифровка разделена. */
function passed({ recording, voices }: StepsDebrief): ReadonlySet<DebriefStep> {
  const voiced = !voices || voices.candidate !== null;
  if (!recording || recording.status === 'failed') return new Set();
  if (recording.status !== 'ready' || !voiced) return new Set(['source']);
  return new Set(['source', 'voices']);
}

/** Шаги разбора записи (I4b → I4c → I4): пройденные с галочкой, текущий с номером. */
export function DebriefSteps(props: {
  readonly responseId: string;
  readonly current: DebriefStep;
  readonly debrief: StepsDebrief;
}) {
  const steps = passed(props.debrief);
  const inApp = isTauriEnvironment();
  return (
    <ol className="ctx-steps ir-rec-steps" aria-label="Шаги разбора записи">
      {STEPS.map((step, position) => {
        const now = step.id === props.current;
        const done = !now && steps.has(step.id);
        return (
          <li key={step.id} className={done ? 'is-done' : now ? 'is-now' : undefined}>
            <Link
              to={stepPath(step.id, props.responseId, inApp)}
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
