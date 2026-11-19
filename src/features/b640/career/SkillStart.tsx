import type { RoleSkillAssessmentCurrent } from '../../skills/roleSkillAssessmentApi';
import { Button, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { BlockError } from '../today/parts';

export interface SkillStartProps {
  readonly current: RoleSkillAssessmentCurrent;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onStart: () => void;
  readonly onRetry: () => void;
}

function Lead(props: { readonly title: string; readonly children?: React.ReactNode }) {
  return (
    <section className="lead" aria-labelledby="sk-title">
      <h2 className="lead-title is-long" id="sk-title">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

const toRoles = (
  <Link className="btn is-primary" to={buildNodePath('s09')}>
    Выбрать роль
  </Link>
);

/** Строка пустого состояния, когда проверку начать нельзя. */
export function blockedLine(current: RoleSkillAssessmentCurrent): string | null {
  if (current.state === 'role_not_selected') return 'Сначала выберите роль поиска.';
  if (current.state === 'too_few_vacancies')
    return `По роли «${current.roleTitle}» мало вакансий для проверки: ${current.sampleSize} из ${current.threshold}.`;
  if (current.state === 'insufficient_requirements')
    return `Требования роли «${current.roleTitle}» ещё собираются из вакансий.`;
  return null;
}

/** Вход в проверку: роль и её навыки до первого вопроса. */
export function SkillStart({ current, busy, failed, onStart, onRetry }: SkillStartProps) {
  const blocked = blockedLine(current);
  if (blocked) return <Lead title={blocked}>{toRoles}</Lead>;
  if (current.state !== 'ready' && current.state !== 'role_changed')
    return <BlockError text="Не удалось загрузить проверку навыков." onRetry={onRetry} />;
  const role = current.state === 'ready' ? current.roleTitle : current.run.roleTitle;
  const skills = current.state === 'ready' ? current.skills.slice(0, 5) : [];
  return (
    <Lead title={`Проверка навыков роли «${role}»`}>
      {skills.length > 0 ? (
        <ul className="rows exp-rows" aria-label="Навыки роли">
          {skills.map((skill) => (
            <li className="row" key={skill.skillId}>
              <div className="row-title">{skill.name}</div>
              <span className="row-meta num">в {skill.vacancyCount} вак.</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="actions">
        <Button variant="primary" icon="checkc" busy={busy} onClick={onStart}>
          Начать проверку
        </Button>
      </div>
      {failed ? <StatusLine state="err" text="Проверка не началась. Попробуйте ещё раз." /> : null}
    </Lead>
  );
}
