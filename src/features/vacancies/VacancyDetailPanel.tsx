import { ArrowLeft, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import { openTargetLabel } from './vacancyOpenTarget';
import type { VacancyApplications } from './useVacancyApplications';

/**
 * Детальная панель «Вакансии» (B248/B250) — макет `vacancies.html`. Сетка
 * «Стадия компании / Кто рекрутирует / Причина открытия роли / Подчинение»
 * рисует только то, что реально есть в `companyFeatures`: обогатитель этих
 * четырёх полей ещё не построен (`mockup-data-gap.md`), так что сегодня блок
 * скрыт целиком, а не подставляет пустые строки.
 */
export function VacancyDetailPanel({
  item,
  now,
  applications,
  onBack,
}: {
  readonly item: MatchedVacancyItem;
  readonly now: string;
  readonly applications?: VacancyApplications;
  readonly onBack: () => void;
}) {
  const { cluster, explanation } = item;
  const age = vacancyAge(cluster, now);
  const source = vacancySourceLabels(cluster.sources)[0];
  const signals = vacancySignals(cluster);
  const application = applications?.byCluster.get(cluster.id);
  const alreadyApplied = application?.status === 'applied';

  return (
    <div className="vacancies-detail-panel">
      <button type="button" className="vacancies-detail-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Назад</span>
      </button>

      <div className="vacancies-detail-head">
        <span className="vac-logo vacancies-detail-logo" aria-hidden="true">
          {logoInitials(cluster.canonicalCompany)}
        </span>
        <div>
          <h2 className="vacancies-detail-title">{cluster.canonicalTitle}</h2>
          <div className="vacancies-detail-company">
            {[cluster.canonicalCompany, cluster.canonicalLocation, cluster.isRemote ? 'удалённо' : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      <div className="vacancies-detail-meta-row">
        {explanation.levelMatch ? (
          <span className="vacancies-chip is-selected">Уровень совпадает</span>
        ) : null}
        <span className="vacancies-chip vacancies-chip-success">
          {age.days === 0 ? 'Сегодня в базе' : `${age.label} в базе`}
        </span>
        {source ? <span className="vacancies-chip">Опубликована на {source}</span> : null}
      </div>

      {signals.length > 0 ? (
        <dl className="vacancies-signals">
          {signals.map(({ label, value }) => (
            <div className="vacancies-signal" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {explanation.matchingPoints.length > 0 ? (
        <div className="vacancies-req-block">
          <h4>Совпадает по фактам профиля</h4>
          <ul className="vacancies-req-list">
            {explanation.matchingPoints.map((point) => (
              <li className="vacancies-req-yes" key={point}>
                <Check size={14} weight="bold" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {explanation.missingPoints.length > 0 ? (
        <div className="vacancies-req-block">
          <h4>Не подтверждено — спросят на интервью</h4>
          <ul className="vacancies-req-list">
            {explanation.missingPoints.map((point) => (
              <li className="vacancies-req-no" key={point}>
                <Warning size={14} weight="bold" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="vacancies-req-block">
        <h4>Вилка</h4>
        <p className="vacancies-comp-note">{formatCompensationCompact(cluster.salary)}</p>
      </div>

      <div className="vacancies-detail-actions">
        {alreadyApplied ? (
          <span className="vacancies-chip is-selected vacancies-detail-applied">Отклик отмечен</span>
        ) : (
          <a
            className="vacancies-btn vacancies-btn-primary"
            href={cluster.primaryUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              applications?.record(cluster.id, 'opened', {
                title: cluster.canonicalTitle,
                company: cluster.canonicalCompany ?? '',
                url: cluster.primaryUrl,
                source: cluster.sources[0]?.sourceId ?? '',
              })
            }
          >
            Откликнуться
          </a>
        )}
        <a
          className="vacancies-btn vacancies-btn-secondary"
          href={cluster.primaryUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ещё · {openTargetLabel(cluster.sources)}
        </a>
      </div>
    </div>
  );
}

function logoInitials(company: string): string {
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .filter(Boolean);
  return letters.slice(0, 2).join('') || '—';
}

interface VacancySignal {
  readonly label: string;
  readonly value: string;
}

/**
 * Сегодня `companyFeatures` не несёт ни одного из четырёх полей карточки
 * (стадия компании/рекрутер/причина открытия/подчинение) — обогатитель ещё
 * не построен. Функция уже перечисляет их, чтобы включить блок одним местом,
 * когда бэкенд начнёт присылать значения, вместо выдумывания данных сейчас.
 */
function vacancySignals(cluster: MatchedVacancyItem['cluster']): readonly VacancySignal[] {
  void cluster;
  return [];
}
