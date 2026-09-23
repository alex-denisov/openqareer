import { PathCheckIcon } from './sectionIcons';
import type { PathDestination, PathStep, PathStepState } from './pathIndicator';

interface CareerPathIndicatorProps {
  readonly steps: readonly PathStep[];
  readonly onNavigate: (destination: PathDestination) => void;
}

const DATA_STATE: Record<PathStepState, 'done' | 'active' | 'pending'> = {
  done: 'done',
  'in-progress': 'active',
  'not-started': 'pending',
};

/**
 * B248 — the one path indicator that repeats on every campaign screen:
 * Профиль → Роль → Подборка → Отклики → Интервью
 * (`docs/v1-release/tasks/work/B248/career-consultant-notes.md` §2). Clicking
 * a step opens the nearest existing screen where the reason can be closed;
 * this component never decides state itself, it only renders `pathIndicator`.
 */
export function CareerPathIndicator({ steps, onNavigate }: CareerPathIndicatorProps) {
  return (
    <nav className="career-path" aria-label="Прогресс кампании">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className="career-path-step"
          data-state={DATA_STATE[step.state]}
        >
          <button
            type="button"
            className="career-path-btn"
            onClick={() => onNavigate(step.destination)}
            aria-label={`${step.label}. ${step.state === 'done' ? 'Готово' : step.reason}`}
          >
            <span className="career-path-dot" aria-hidden="true">
              {step.state === 'done' ? <PathCheckIcon size={13} /> : null}
            </span>
            <span className="career-path-copy">
              <span className="career-path-label">{step.label}</span>
              {step.state === 'done' ? null : (
                <span className="career-path-reason">{step.reason}</span>
              )}
            </span>
          </button>
          {index < steps.length - 1 ? (
            <span className="career-path-connector" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </nav>
  );
}
