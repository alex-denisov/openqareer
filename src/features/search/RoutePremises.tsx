import type { AccountSnapshot } from '../coach/coachApi';
import {
  candidateRegionLabels,
  type CandidateRegion,
} from '../workspace/candidateRegions';

/**
 * Предпосылки маршрута: роль, география и формат — то, из чего собирается
 * поисковый запрос. Блок переехал сюда вместе с «Поиском», который стал
 * кампанией из макета «Пульт» (B179).
 */
export function CareerRoutePremises({
  targetRole,
  regions,
  workMode,
  editDisabled = false,
  onEdit,
}: {
  targetRole?: string;
  regions: readonly CandidateRegion[];
  workMode?: AccountSnapshot['profile']['workMode'];
  editDisabled?: boolean;
  onEdit: () => void;
}) {
  return (
    <section className="career-route-premises" aria-labelledby="career-route-premises-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Изменяемые предпосылки</span>
          <h3 id="career-route-premises-title">Роль и условия маршрута</h3>
        </div>
        <button type="button" onClick={onEdit} disabled={editDisabled}>
          {editDisabled ? 'Читаем текущие ответы…' : 'Изменить роль и условия'}
        </button>
      </header>
      <dl>
        <div>
          <dt>Роль и уровень</dt>
          <dd>{targetRole?.trim() || 'Уточняются'}</dd>
        </div>
        <div>
          <dt>География</dt>
          <dd>
            {candidateRegionLabels(regions).join(', ') || 'Регионы не выбраны'}
          </dd>
        </div>
        <div>
          <dt>Формат работы</dt>
          <dd>{routeWorkModeLabel(workMode)}</dd>
        </div>
      </dl>
      <p>
        После сохранения гипотезы и поисковый запрос пересчитываются; прошлые
        варианты остаются обратимыми.
      </p>
    </section>
  );
}

function routeWorkModeLabel(mode?: AccountSnapshot['profile']['workMode']): string {
  if (!mode) return 'Не указан';
  return { remote: 'Удалённо', hybrid: 'Гибрид', office: 'Офис', flexible: 'Гибко' }[mode];
}
