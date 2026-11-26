import type { RoleSkillAssessmentRun } from '../../../../server/domain/roleSkillAssessment';
import type { RoleSkillAssessmentUiState } from '../../skills/roleSkillAssessmentState';
import { ActionDock, Button, StatusLine } from '../kit';

export interface SkillSuggestionsProps {
  readonly run: RoleSkillAssessmentRun;
  readonly state: RoleSkillAssessmentUiState;
  readonly onToggle: (id: string, accepted: boolean, statement: string) => void;
  readonly onSave: () => void;
  readonly onSkip: () => void;
  readonly onRetry: () => void;
}

const isOn = (state: RoleSkillAssessmentUiState, id: string): boolean =>
  state.suggestionDrafts[id]?.accepted ?? true;

function SuggestionsFailed(props: {
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onSkip: () => void;
}) {
  return (
    <section className="lead" aria-labelledby="sg-title">
      <h2 className="lead-title is-long" id="sg-title">
        Не удалось собрать факты из ответов
      </h2>
      <div className="actions">
        <Button variant="primary" icon="repeat" busy={props.busy} onClick={props.onRetry}>
          Повторить
        </Button>
        <Button onClick={props.onSkip}>Перейти к кейсам</Button>
      </div>
    </section>
  );
}

/** После разговора о роли: факты из ответов, которые можно добавить в профиль. */
export function SkillSuggestions({
  run,
  state,
  onToggle,
  onSave,
  onSkip,
  onRetry,
}: SkillSuggestionsProps) {
  const failedModel = run.status === 'model_error' && run.modelError?.action === 'suggestions';
  const count = run.suggestions.filter((item) => isOn(state, item.id)).length;
  if (failedModel) return <SuggestionsFailed busy={state.busy} onRetry={onRetry} onSkip={onSkip} />;
  return (
    <section className="lead" aria-labelledby="sg-title">
      <h2 className="lead-title is-long" id="sg-title">
        Что добавить в профиль
      </h2>
      <ul className="vt-opts" aria-label="Факты из ответов">
        {run.suggestions.map((item) => (
          <li key={item.id}>
            <label className="vt-opt">
              <input
                type="checkbox"
                checked={isOn(state, item.id)}
                onChange={(event) => onToggle(item.id, event.target.checked, item.statement)}
              />
              <span className="vt-opt-t">{item.statement}</span>
            </label>
          </li>
        ))}
      </ul>
      <ActionDock
        kind="commit"
        primary={
          <Button variant="primary" icon="check" busy={state.busy} onClick={onSave}>
            {count > 0 ? `Добавить в профиль · ${count}` : 'Дальше без изменений'}
          </Button>
        }
      />
      {state.error ? (
        <StatusLine state="err" text="Не сохранилось. Отметки остались — попробуйте ещё раз." />
      ) : null}
    </section>
  );
}
