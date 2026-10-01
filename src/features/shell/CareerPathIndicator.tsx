import { PathCheckIcon } from './sectionIcons';
import type { NavigationOptions, PathDestination, PathStep } from './pathIndicator';


interface CareerPathIndicatorProps {
  readonly steps: readonly PathStep[];
  readonly onNavigate: (destination: PathDestination, options?: NavigationOptions) => void;
}

function stepDataState(step: PathStep): 'done' | 'active' | 'pending' {
  if (step.isCurrent) return 'active';
  if (step.state === 'done') return 'done';
  return 'pending';
}

function currentStepOf(steps: readonly PathStep[]): {
  readonly step: PathStep;
  readonly index: number;
} {
  const explicitIndex = steps.findIndex((step) => step.isCurrent);
  if (explicitIndex >= 0) {
    return { step: steps[explicitIndex]!, index: explicitIndex };
  }
  const inProgressIndex = steps.findIndex((step) => step.state === 'in-progress');
  const pendingIndex = steps.findIndex((step) => step.state === 'not-started');
  const currentIndex =
    inProgressIndex >= 0 ? inProgressIndex : pendingIndex >= 0 ? pendingIndex : steps.length - 1;
  return { step: steps[currentIndex]!, index: currentIndex };
}

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
      <DesktopPathSteps steps={steps} onNavigate={onNavigate} />
      <MobilePathSummary steps={steps} onNavigate={onNavigate} />
    </nav>
  );
}

function DesktopPathSteps({ steps, onNavigate }: CareerPathIndicatorProps) {
  return (
    <div className="career-path-desktop">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className="career-path-step"
          data-state={stepDataState(step)}
          data-status={step.state}
          data-current={step.isCurrent ? 'true' : 'false'}
        >
          <button
            type="button"
            className="career-path-btn"
            onClick={() => onNavigate(step.destination, step.navigationOptions)}
            aria-current={step.isCurrent ? 'step' : undefined}
            aria-label={`${step.label}. ${step.state === 'done' ? 'Готово' : step.reason}`}
          >
            <span className="career-path-dot" aria-hidden="true">
              {step.state === 'done' ? <PathCheckIcon size={13} /> : null}
            </span>
            <span className="career-path-copy">
              <span className="career-path-label">{step.label}</span>
              {step.state === 'done' && !step.isCurrent ? null : (
                <span className="career-path-reason">{step.reason}</span>
              )}
            </span>
          </button>
          {index < steps.length - 1 ? (
            <span className="career-path-connector" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MobilePathSummary({ steps, onNavigate }: CareerPathIndicatorProps) {
  const current = currentStepOf(steps);
  const roleStep = steps.find((step) => step.id === 'role');
  return (
    <>
      <button
        type="button"
        className="career-path-mobile-summary"
        onClick={() => onNavigate(current.step.destination, current.step.navigationOptions)}
        aria-label={`Шаг ${current.index + 1} из ${steps.length}. ${current.step.label}. ${current.step.reason}`}
      >
        <span className="career-path-mobile-dots" aria-hidden="true">
          {steps.map((step) => (
            <span
              key={step.id}
              data-state={stepDataState(step)}
              data-status={step.state}
            />
          ))}
        </span>

        <span>
          Шаг {current.index + 1} из {steps.length}
        </span>
        <span className="career-path-mobile-label">{current.step.label}</span>
        <span className="career-path-mobile-reason">{current.step.reason}</span>
      </button>
      {roleStep && current.step.id !== roleStep.id ? (
        <button
          type="button"
          className="career-quiet-button career-path-mobile-role"
          onClick={() => onNavigate(roleStep.destination)}
          aria-label={`${roleStep.label}. ${roleStep.state === 'done' ? 'Готово' : roleStep.reason}`}
        >
          Настроить роль
        </button>
      ) : null}
    </>
  );
}
