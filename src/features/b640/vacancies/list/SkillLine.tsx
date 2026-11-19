import { useEffect, useState } from 'react';
import { readSkillGap } from '../../career/careerApi';
import { skillCheckPath } from '../../career/skillCheckModel';
import { Icon, Link } from '../../kit';
import { pluralRu } from '../format';

export function skillLineText(count: number): string {
  return `Проверить ${count} ${pluralRu(count, 'навык', 'навыка', 'навыков')}`;
}

/** Сколько частых требований роли поиска ещё не подтверждено в профиле. */
function useSkillGap(roles: readonly string[]): number {
  const [gap, setGap] = useState(0);
  const key = roles.join('\n');
  useEffect(() => {
    let alive = true;
    void readSkillGap(roles).then((value) => {
      if (alive) setGap(value);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return gap;
}

/** Строка под фильтрами: ссылка на проверку навыков роли поиска. Нет пробелов — строки нет. */
export function SkillLine({ roles }: { readonly roles: readonly string[] }) {
  const gap = useSkillGap(roles);
  if (gap <= 0) return null;
  return (
    <p className="vt-skill">
      <Link className="row-act is-sm" to={skillCheckPath(roles[0])}>
        <Icon name="checkc" />
        {skillLineText(gap)}
      </Link>
    </p>
  );
}
