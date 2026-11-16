import { Link } from '../../kit';
import { buildNodePath } from '../../routes';

/** Шаги отклика: «Вакансия» (текущий), «Отклик», «Ответ». */
export function StepTabs({ vacancyId }: { readonly vacancyId: string }) {
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in">
        <Link to={buildNodePath('v04', { vacancyId })} aria-current="page">
          Вакансия
        </Link>
        <Link to={buildNodePath('o02', { responseId: vacancyId })}>Отклик</Link>
        <Link to={buildNodePath('o01')}>Ответ</Link>
      </div>
    </nav>
  );
}
