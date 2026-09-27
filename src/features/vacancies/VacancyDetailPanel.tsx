import { useState } from 'react';
import { ArrowLeft, Check, Warning } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { vacancyAge } from './vacancyFilters';
import { formatCompensationCompact } from './vacancyCompensation';
import { openTargetLabel } from './vacancyOpenTarget';
import type { VacancyApplications } from './useVacancyApplications';
import { VacancyPitchModal } from './VacancyPitchModal';
import { VacancyInfoModal } from './VacancyInfoModal';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
import { recruiterEnrichPayload } from './recruiterEnrichPayload';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';
import { vacancyLevelMatchLabel } from './vacancyLevelMatch';

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
  /** Opens «Отклики» after the candidate confirms an application (B251 F5,
   * C47): without this door the tracker card was reachable only by rail
   * click, and nothing told the candidate it existed. */
  readonly onOpenResponses?: () => void;
  /** Opens the profile so the candidate can add the experience that covers
   * the requirement; without a handler the button is not rendered. */
  readonly onAddToProfile?: () => void;
}

export function VacancyDetailPanel({
  item,
  now,
  applications,
  onBack,
  onOpenResponses,
  onAddToProfile,
}: VacancyDetailPanelProps) {
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
        title="Требования вакансии, которых нет в вашем профиле"
        subtitle="Подтвердите опытом в профиле — или будьте готовы обсудить на интервью"
        points={explanation.missingPoints}
        tone="no"
        actionLabel="Добавить в профиль"
        onAction={onAddToProfile}
      />

      <div className="vacancies-req-block">
        <h4>Вилка</h4>
        <p className="vacancies-comp-note">{formatCompensationCompact(cluster.salary)}</p>
      </div>

      <VacancyRecruiterBlock cluster={cluster} />

      <VacancyDetailActions
        cluster={cluster}
        alreadyApplied={alreadyApplied}
        applications={applications}
        onOpenResponses={onOpenResponses}
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
      <VacancyLevelChip match={explanation.levelMatch} />
      <span className="vacancies-chip vacancies-chip-success">
        {age.days === 0 ? 'Сегодня в базе' : `${age.label} в базе`}
      </span>
      {source ? <span className="vacancies-chip">Опубликована на {source}</span> : null}
    </div>
  );
}

function VacancyLevelChip({ match }: { readonly match: VacancyLevelMatch }) {
  const label = vacancyLevelMatchLabel(match);
  return (
    <span
      className={`vacancies-chip${match === 'match' ? ' is-selected' : ''}${match === 'unknown' ? ' is-unknown' : ''}`}
      title={label}
      aria-label={label}
    >
      {label}
    </span>
  );
}

/**
 * Compact «Кто нанимает» — the search itself and its result (contact list,
 * or an honest "not found"/error notice from `RecruiterContactsBlock`, never
 * a spinner that never resolves) sit under the matches, above the action
 * row (owner acceptance 2026-09-25).
 */
function VacancyRecruiterBlock({ cluster }: { readonly cluster: MatchedVacancyItem['cluster'] }) {
  return (
    <div className="vacancies-req-block vacancies-recruiter-block">
      <h4>Кто нанимает</h4>
      <RecruiterContactsBlock
        vacancyId={cluster.id}
        vacancyPayload={recruiterEnrichPayload(cluster)}
      />
    </div>
  );
}

function VacancyDetailActions({
  cluster,
  alreadyApplied,
  applications,
  onOpenResponses,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly alreadyApplied: boolean;
  readonly applications?: VacancyApplications;
  readonly onOpenResponses?: () => void;
}) {
  const target = openTargetLabel(cluster.sources);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleApply = () => {
    void openExternalLink(cluster.primaryUrl);
    // 'applied', not 'opened' (B251 F5): the detail panel is a single-click
    // decision, unlike the list row's separate «открыл → откликнулся» pair —
    // and only 'applied' puts a card into the «Отклики» tracker.
    applications?.record(cluster.id, 'applied', {
      title: cluster.canonicalTitle,
      company: cluster.canonicalCompany ?? '',
      url: cluster.primaryUrl,
      source: cluster.sources[0]?.sourceId ?? '',
    });
  };

  return (
    <div className="vacancies-detail-actions">
      {alreadyApplied ? (
        <AppliedStatus target={target} onOpenResponses={onOpenResponses} />
      ) : (
        <button type="button" className="vacancies-btn vacancies-btn-primary" onClick={handleApply}>
          Откликнуться
        </button>
      )}
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => setInfoOpen(true)}
      >
        Подробнее
      </button>
      <VacancyPitchDoor cluster={cluster} />
      <VacancyInfoModal isOpen={infoOpen} onClose={() => setInfoOpen(false)} cluster={cluster} />
    </div>
  );
}

/** Chip plus the door to «Отклики» (B251 F5, C47): confirming an application
 * has to tell the candidate the tracker card exists, not just stop talking. */
function AppliedStatus({
  target,
  onOpenResponses,
}: {
  readonly target: string;
  readonly onOpenResponses?: () => void;
}) {
  return (
    <>
      <span className="vacancies-chip is-selected vacancies-detail-applied">
        Отклик отмечен · открыт {target}
      </span>
      {onOpenResponses ? (
        <button
          type="button"
          className="vacancies-btn vacancies-btn-secondary"
          onClick={onOpenResponses}
        >
          Перейти в «Отклики»
        </button>
      ) : null}
    </>
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
        Сопроводительное письмо
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
  subtitle,
  points,
  tone,
  actionLabel,
  onAction,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly points: readonly string[];
  readonly tone: 'yes' | 'no';
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  if (points.length === 0) return null;
  const Icon = tone === 'yes' ? Check : Warning;
  return (
    <div className="vacancies-req-block">
      <h4>{title}</h4>
      {subtitle ? <p className="vacancies-req-subtitle">{subtitle}</p> : null}
      <ul className="vacancies-req-list">
        {points.map((point) => (
          <li className={`vacancies-req-${tone}`} key={point}>
            <div className="vacancies-req-item-main">
              <Icon size={14} weight="bold" aria-hidden="true" />
              <span>{point}</span>
            </div>
            {actionLabel && onAction ? (
              <button
                type="button"
                className="vacancies-req-action-btn"
                onClick={onAction}
              >
                {actionLabel}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
