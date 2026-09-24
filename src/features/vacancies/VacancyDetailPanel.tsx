import { useState } from 'react';
import { ArrowLeft, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import { openTargetLabel } from './vacancyOpenTarget';
import type { VacancyApplications } from './useVacancyApplications';
import { VacancyPitchModal } from './VacancyPitchModal';

/**
 * Детальная панель «Вакансии» (B248/B250) — макет `vacancies.html`. Сетка
 * «Стадия компании / Кто рекрутирует / Причина открытия роли / Подчинение»
 * рисует только то, что реально есть в `companyFeatures`: обогатитель этих
 * четырёх полей ещё не построен (`mockup-data-gap.md`), так что сегодня блок
 * скрыт целиком, а не подставляет пустые строки.
 */
interface VacancyDetailPanelProps {
  readonly item: MatchedVacancyItem;
  readonly now: string;
  readonly applications?: VacancyApplications;
  readonly onBack: () => void;
}

export function VacancyDetailPanel({ item, now, applications, onBack }: VacancyDetailPanelProps) {
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

      <VacancyDetailHead cluster={cluster} />
      <VacancyDetailMetaRow explanation={explanation} age={age} source={source} />

      <VacancySignalGrid signals={signals} />
      <VacancyRequirementList
        title="Совпадает по фактам профиля"
        points={explanation.matchingPoints}
        tone="yes"
      />
      <VacancyRequirementList
        title="Не подтверждено — спросят на интервью"
        points={explanation.missingPoints}
        tone="no"
      />

      <div className="vacancies-req-block">
        <h4>Вилка</h4>
        <p className="vacancies-comp-note">{formatCompensationCompact(cluster.salary)}</p>
      </div>

      <VacancyDetailActions
        cluster={cluster}
        alreadyApplied={alreadyApplied}
        applications={applications}
      />
    </div>
  );
}

function VacancyDetailHead({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <div className="vacancies-detail-head">
      <span className="vac-logo vacancies-detail-logo" aria-hidden="true">
        {logoInitials(cluster.canonicalCompany)}
      </span>
      <div>
        <h2 className="vacancies-detail-title">{cluster.canonicalTitle}</h2>
        <div className="vacancies-detail-company">
          {[
            cluster.canonicalCompany,
            cluster.canonicalLocation,
            cluster.isRemote ? 'удалённо' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
    </div>
  );
}

function VacancyDetailMetaRow({
  explanation,
  age,
  source,
}: {
  readonly explanation: MatchedVacancyItem['explanation'];
  readonly age: ReturnType<typeof vacancyAge>;
  readonly source?: string;
}) {
  return (
    <div className="vacancies-detail-meta-row">
      {explanation.levelMatch ? (
        <span className="vacancies-chip is-selected">Уровень совпадает</span>
      ) : null}
      <span className="vacancies-chip vacancies-chip-success">
        {age.days === 0 ? 'Сегодня в базе' : `${age.label} в базе`}
      </span>
      {source ? <span className="vacancies-chip">Опубликована на {source}</span> : null}
    </div>
  );
}

function VacancyDetailActions({
  cluster,
  alreadyApplied,
  applications,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly alreadyApplied: boolean;
  readonly applications?: VacancyApplications;
}) {
  return (
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
      <VacancyPitchDoor cluster={cluster} />
    </div>
  );
}

/** The old board's cover-letter door (B232): the new screen must not drop a
 *  feature the candidate already had on prod. */
function VacancyPitchDoor({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  const [pitchOpen, setPitchOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => setPitchOpen(true)}
      >
        Собрать письмо
      </button>
      {pitchOpen ? (
        <VacancyPitchModal
          isOpen
          onClose={() => setPitchOpen(false)}
          vacancy={{
            id: cluster.id,
            title: cluster.canonicalTitle,
            company: cluster.canonicalCompany,
            location: cluster.canonicalLocation,
            isRemote: cluster.isRemote,
            skills: cluster.skills,
            descriptionSummary: cluster.descriptionSummary,
          }}
        />
      ) : null}
    </>
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

function VacancySignalGrid({
  signals,
}: {
  readonly signals: readonly { readonly label: string; readonly value: string }[];
}) {
  if (signals.length === 0) return null;
  return (
    <dl className="vacancies-signals">
      {signals.map(({ label, value }) => (
        <div className="vacancies-signal" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function VacancyRequirementList({
  title,
  points,
  tone,
}: {
  readonly title: string;
  readonly points: readonly string[];
  readonly tone: 'yes' | 'no';
}) {
  if (points.length === 0) return null;
  const Icon = tone === 'yes' ? Check : Warning;
  return (
    <div className="vacancies-req-block">
      <h4>{title}</h4>
      <ul className="vacancies-req-list">
        {points.map((point) => (
          <li className={`vacancies-req-${tone}`} key={point}>
            <Icon size={14} weight="bold" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
