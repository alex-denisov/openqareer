import { useEffect, useRef } from 'react';
import type { RoleSkillAssessmentCurrent } from '../../skills/roleSkillAssessmentApi';
import { Button, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { skillCheckPath } from './skillCheckModel';
import { useRoleLabel } from './roleLabelContext';

export interface SkillStartProps {
  readonly current: RoleSkillAssessmentCurrent;
  readonly busy: boolean;
  readonly failed: boolean;
  /** Роли поиска, которые можно проверить вместо этой. */
  readonly otherRoles: readonly string[];
  readonly onStart: () => void;
  readonly onRetry: () => void;
}

/** Строка, когда проверку этой роли начать нельзя. */
export function blockedLine(
  current: RoleSkillAssessmentCurrent,
  label: (title: string) => string = (title) => title,
): string | null {
  if (current.state === 'role_not_selected') return 'Сначала выберите роль поиска.';
  if (current.state === 'too_few_vacancies')
    return `По роли «${label(current.roleTitle)}» мало вакансий для проверки: ${current.sampleSize} из ${current.threshold}.`;
  if (current.state === 'insufficient_requirements')
    return current.collecting
      ? `Требования роли «${label(current.roleTitle)}» ещё собираются из вакансий.`
      : `По роли «${label(current.roleTitle)}» в вакансиях мало требований для проверки.`;
  return null;
}

/** Выбор роли на месте: другие роли поиска, иначе — выбор роли поиска в «Карьере». */
function RoleChoice({ roles }: { readonly roles: readonly string[] }) {
  const label = useRoleLabel();
  if (roles.length === 0)
    return (
      <div className="actions">
        <Link className="btn is-primary" to={`${buildNodePath('s09')}?pick=1`}>
          Выбрать роль
        </Link>
      </div>
    );
  return (
    <div className="actions">
      {roles.map((role) => (
        <Link className="btn" key={role} to={skillCheckPath(role)}>
          Проверить «{label(role)}»
        </Link>
      ))}
    </div>
  );
}

/** Проверка готова — первый вопрос открывается сразу, без промежуточного экрана (макет C4). */
function AutoStart({
  busy,
  failed,
  onStart,
}: Pick<SkillStartProps, 'busy' | 'failed' | 'onStart'>) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onStart();
  }, [onStart]);
  if (failed && !busy)
    return <BlockError text="Проверка не началась. Попробуйте ещё раз." onRetry={onStart} />;
  return <BlockSkeleton label="Готовим первый вопрос" rows={3} />;
}

/** Вход в проверку: короткая строка, если роль проверить нельзя; иначе — сразу первый вопрос. */
export function SkillStart({
  current,
  busy,
  failed,
  otherRoles,
  onStart,
  onRetry,
}: SkillStartProps) {
  const label = useRoleLabel();
  const blocked = blockedLine(current, label);
  if (blocked)
    return (
      <section className="lead" aria-label="Проверка навыков">
        <StatusLine state="wait" text={blocked} />
        <RoleChoice roles={otherRoles} />
      </section>
    );
  if (current.state === 'ready') return <AutoStart busy={busy} failed={failed} onStart={onStart} />;
  if (current.state === 'counting')
    return failed ? (
      <BlockError text="Не удалось загрузить проверку навыков." onRetry={onRetry} />
    ) : (
      <section className="lead" aria-label="Проверка навыков" aria-live="polite">
        <StatusLine state="wait" text="Считаем вакансии роли…" />
      </section>
    );
  if (current.state !== 'role_changed')
    return <BlockError text="Не удалось загрузить проверку навыков." onRetry={onRetry} />;
  return (
    <section className="lead" aria-labelledby="sk-title">
      <h2 className="lead-title is-long" id="sk-title">
        Проверка навыков роли «{label(current.run.roleTitle)}»
      </h2>
      <div className="actions">
        <Button variant="primary" icon="checkc" busy={busy} onClick={onStart}>
          Начать проверку
        </Button>
      </div>
      {failed ? <StatusLine state="err" text="Проверка не началась. Попробуйте ещё раз." /> : null}
    </section>
  );
}
