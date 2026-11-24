import { useEffect, useMemo, useState } from 'react';
import { readSkillGap } from '../../career/careerApi';
import { skillCheckPath } from '../../career/skillCheckModel';
import { Icon, Link } from '../../kit';
import { pluralRu } from '../format';

export function skillLineText(count: number): string {
  return `Проверить ${count} ${pluralRu(count, 'навык', 'навыка', 'навыков')}`;
}

/** Сколько частых требований роли поиска ещё не подтверждено в профиле. */
function useSkillGap(
  roles: readonly string[],
  ready: boolean,
): { readonly gap: number; readonly role: string | null } {
  const [gap, setGap] = useState<{ readonly gap: number; readonly role: string | null }>({
    gap: 0,
    role: null,
  });
  const key = roles.join('\n');
  const titles = useMemo(() => (key ? key.split('\n') : []), [key]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void readSkillGap(titles).then((value) => {
      if (alive) setGap(value);
    });
    return () => {
      alive = false;
    };
  }, [titles, ready]);
  return gap;
}

/**
 * Строка под фильтрами: ссылка на проверку навыков роли поиска. Нет пробелов — строки нет.
 * B760: роли спрашиваются, когда подборка дочитана (`ready`), — не вперёд строк списка.
 */
export function SkillLine({
  roles,
  ready,
}: {
  readonly roles: readonly string[];
  readonly ready: boolean;
}) {
  // The link goes to the role whose check is ready, not to the first one: otherwise it is a dead end.
  const { gap, role } = useSkillGap(roles, ready);
  if (gap <= 0 || !role) return null;
  return (
    <p className="vt-skill">
      <Link className="row-act is-sm" to={skillCheckPath(role)}>
        <Icon name="checkc" />
        {skillLineText(gap)}
      </Link>
    </p>
  );
}
